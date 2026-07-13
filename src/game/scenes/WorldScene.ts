import Phaser from 'phaser';
import { PLAYER_CONFIG } from '../config/playerConfig';
import { MAP_CONFIG } from '../config/mapConfig';
import { RemotePlayerInterpolator } from '../network/interpolation';

interface ChessArenaZone {
  id: string;
  name: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zone: Phaser.GameObjects.Zone;
  statusIndicator?: Phaser.GameObjects.Container;
}

interface RemotePlayer {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  interpolator: RemotePlayerInterpolator;
  direction: string;
  isMoving: boolean;
  sessionId: string;
  playerId: string;
}

type MovementSender = (data: {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: string;
  isMoving: boolean;
}) => void;

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private target: { x: number; y: number } | null = null;
  private collisionGroup!: Phaser.Physics.Arcade.StaticGroup;
  private arenas: ChessArenaZone[] = [];
  private otherPlayers: Map<string, RemotePlayer> = new Map();
  private localPlayerId: string = '';
  private localRegion: string = '';
  private lastSentTime = 0;
  private readonly SEND_INTERVAL = 50;
  private movementLocked = false;
  private defaultZoom = 2;
  private boardZoom = 3;
  private movementSender: MovementSender | null = null;

  public onBoardClick?: (arenaId: string, arenaTitle: string) => void;
  public onHouseClick?: (houseId: string) => void;
  public onPositionUpdate?: (x: number, y: number) => void;
  public onPlayerClick?: (userId: string) => void;

  constructor() {
    super({ key: 'WorldScene' });
  }

  preload() {
    this.load.tilemapTiledJSON(MAP_CONFIG.key, MAP_CONFIG.path);

    this.load.spritesheet('player_sprite', PLAYER_CONFIG.path, {
      frameWidth: PLAYER_CONFIG.frameWidth,
      frameHeight: PLAYER_CONFIG.frameHeight,
    });

    const tilesetImages: { name: string; path: string }[] = [
      { name: 'grass', path: 'sprites/tilesets/grass.png' },
      { name: 'plains', path: 'sprites/tilesets/plains.png' },
      { name: 'character', path: 'sprites/characters/player.png' },
      { name: 'decor_8x8', path: 'sprites/tilesets/decor_8x8.png' },
      { name: 'wooden_floor', path: 'sprites/tilesets/floors/wooden.png' },
      { name: 'walls', path: 'sprites/tilesets/walls/walls.png' },
      { name: 'exterior', path: 'sprites/tilesets/exterior.png' },
      { name: 'decor_16x16', path: 'sprites/tilesets/decor_16x16.png' },
      { name: 'Interior', path: 'sprites/tilesets/Interior.png' },
      { name: 'chessboard_small_80', path: 'sprites/tilesets/chessboard_small_80.png' },
      { name: 'fences', path: 'sprites/tilesets/fences.png' },
      { name: 'Pixel 16 v2 village free', path: 'sprites/tilesets/Pixel_16_v2_village_free.png' },
      { name: 'Outdoor_Decor_Free', path: 'sprites/tilesets/Outdoor_Decor_Free.png' },
      { name: 'Water_Tile-modified', path: 'sprites/tilesets/Water_Tile-modified.png' },
      { name: 'Bridge_Wood', path: 'sprites/tilesets/Bridge_Wood.png' },
      { name: 'water1.png', path: 'sprites/tilesets/water1.png' },
      { name: 'objects', path: 'sprites/objects/objects.png' },
      { name: 'Chicken', path: 'sprites/tilesets/Chicken.png' },
      { name: 'wooden_door.tsx', path: 'sprites/tilesets/walls/wooden_door.png' },
      { name: 'house1', path: 'sprites/tilesets/HOUSE_1_-_DAY.png' },
      { name: 'house2', path: 'sprites/tilesets/HOUSE_2_-_DAY.png' },
    ];

    tilesetImages.forEach(ts => {
      const fullPath = MAP_CONFIG.basePath + ts.path;
      this.load.image(ts.name, fullPath);
    });
  }

  create() {
    const map = this.make.tilemap({ key: MAP_CONFIG.key });

    const tilesetNames = [
      'grass', 'plains', 'character', 'decor_8x8', 'wooden_floor',
      'walls', 'exterior', 'decor_16x16', 'Interior', 'chessboard_small_80',
      'fences', 'Pixel 16 v2 village free', 'Outdoor_Decor_Free',
      'Water_Tile-modified', 'Bridge_Wood', 'water1.png', 'objects',
      'Chicken', 'wooden_door.tsx', 'house1', 'house2',
    ];

    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    tilesetNames.forEach(name => {
      const ts = map.addTilesetImage(name, name);
      if (ts) tilesets.push(ts);
    });

    const skipPatterns = MAP_CONFIG.skipLayers.map(s => s.toLowerCase());

    map.layers.forEach((layerData) => {
      const name = layerData.name;
      const lowerName = name.toLowerCase();
      if (skipPatterns.some(p => lowerName.includes(p))) return;
      map.createLayer(name, tilesets);
    });

    map.objects.forEach(objectLayer => {
      const lowerName = objectLayer.name.toLowerCase();
      if (skipPatterns.some(p => lowerName.includes(p))) return;
      if (lowerName === 'collision' || lowerName === 'spawn') return;

      objectLayer.objects.forEach(obj => {
        if (obj.gid && obj.visible !== false) {
          map.createFromObjects(objectLayer.name, { id: obj.id });
        }
      });
    });

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.setupCollision(map);
    this.setupInteractives(map);

    const spawnPoint = this.findSpawnPoint(map);
    this.createPlayer(spawnPoint.x, spawnPoint.y);
    this.createAnimations();

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(2);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.movementLocked) return;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.target = { x: worldPoint.x, y: worldPoint.y };
    });
  }

  update() {
    if (!this.player) return;

    // Update remote players interpolation
    this.otherPlayers.forEach((remote) => {
      const pos = remote.interpolator.getPosition();
      remote.container.x = pos.x;
      remote.container.y = pos.y;

      if (remote.isMoving) {
        if (remote.direction === 'left' || remote.direction === 'right') {
          remote.sprite.anims.play('walk_side', true);
          remote.sprite.setFlipX(remote.direction === 'left');
        } else if (remote.direction === 'down') {
          remote.sprite.anims.play('walk_down', true);
        } else {
          remote.sprite.anims.play('walk_up', true);
        }
      } else {
        remote.sprite.anims.play('idle_down', true);
      }
    });

    if (!this.target) {
      if (this.player.anims?.currentAnim?.key?.startsWith('walk')) {
        this.player.anims.play('idle_down', true);
      }
      return;
    }

    const dx = this.target.x - this.player.x;
    const dy = this.target.y - this.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 4) {
      this.target = null;
      (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0);
      this.player.anims.play('idle_down', true);
      this.emitMovement(false);
      if (this.onPositionUpdate) this.onPositionUpdate(this.player.x, this.player.y);
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const vx = (dx / dist) * PLAYER_CONFIG.speed;
    const vy = (dy / dist) * PLAYER_CONFIG.speed;
    body.setVelocity(vx, vy);

    let direction: 'up' | 'down' | 'left' | 'right' = 'down';
    if (Math.abs(dx) > Math.abs(dy)) {
      this.player.anims.play('walk_side', true);
      this.player.setFlipX(dx < 0);
      direction = dx < 0 ? 'left' : 'right';
    } else if (dy > 0) {
      this.player.anims.play('walk_down', true);
      this.player.setFlipX(false);
      direction = 'down';
    } else {
      this.player.anims.play('walk_up', true);
      this.player.setFlipX(false);
      direction = 'up';
    }

    const now = Date.now();
    if (now - this.lastSentTime >= this.SEND_INTERVAL) {
      this.emitMovement(true, direction);
      this.lastSentTime = now;
    }

    if (this.onPositionUpdate && this.game.loop.frame % 30 === 0) {
      this.onPositionUpdate(this.player.x, this.player.y);
    }
  }

  private emitMovement(isMoving: boolean, direction: 'up' | 'down' | 'left' | 'right' = 'down') {
    if (!this.movementSender) return;
    this.movementSender({
      x: this.player.x,
      y: this.player.y,
      targetX: this.target?.x ?? this.player.x,
      targetY: this.target?.y ?? this.player.y,
      direction,
      isMoving,
    });
  }

  private findSpawnPoint(map: Phaser.Tilemaps.Tilemap): { x: number; y: number } {
    const spawnLayer = map.objects.find(l => l.name.toLowerCase() === 'spawn');
    if (spawnLayer) {
      const spawnObj = spawnLayer.objects.find(
        o => o.name === 'player_spawn' || (o.type && o.type.toLowerCase() === 'spawn')
      );
      if (spawnObj && spawnObj.x !== undefined && spawnObj.y !== undefined) {
        return { x: spawnObj.x, y: spawnObj.y };
      }
    }
    return { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
  }

  private setupCollision(map: Phaser.Tilemaps.Tilemap) {
    this.collisionGroup = this.physics.add.staticGroup();
    const collisionLayer = map.objects.find(l => l.name.toLowerCase() === 'collision');
    if (!collisionLayer) return;

    collisionLayer.objects.forEach(obj => {
      if (obj.x !== undefined && obj.y !== undefined && obj.width && obj.height) {
        const rect = this.add.rectangle(
          obj.x + obj.width / 2,
          obj.y + obj.height / 2,
          obj.width,
          obj.height
        );
        rect.setVisible(false);
        this.physics.add.existing(rect, true);
        this.collisionGroup.add(rect);
      }
    });
  }

  private setupInteractives(map: Phaser.Tilemaps.Tilemap) {
    let arenaCount = 0;

    map.objects.forEach(objectLayer => {
      objectLayer.objects.forEach(obj => {
        const objType = obj.type || '';
        const objName = obj.name || '';
        const props: any[] = (obj as any).properties || [];

        const propType = props.find((p: any) => p.name === 'type')?.value || '';

        const isChessArena =
          objType.toLowerCase() === 'chess_arena' ||
          propType.toLowerCase() === 'chess_arena' ||
          objName.toLowerCase().includes('chess');

        if (isChessArena && obj.x !== undefined && obj.y !== undefined) {
          const id = props.find((p: any) => p.name === 'id')?.value || `arena_${arenaCount + 1}`;
          const title = props.find((p: any) => p.name === 'title')?.value || objName || `Arena ${arenaCount + 1}`;

          const w = obj.width || 80;
          const h = obj.height || 80;

          const zone = this.add.zone(obj.x + w / 2, obj.y + h / 2, w, h);
          zone.setInteractive({ useHandCursor: true });
          zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            if (this.onBoardClick) this.onBoardClick(id, title);
          });

          this.arenas.push({ id, name: objName, title, x: obj.x, y: obj.y, width: w, height: h, zone });
          arenaCount++;
        }
      });
    });

    if (arenaCount === 0) {
      map.objects.forEach(objectLayer => {
        if (objectLayer.name.toLowerCase().includes('chessboard')) {
          objectLayer.objects.forEach(obj => {
            if (obj.x !== undefined && obj.y !== undefined) {
              const id = `arena_${arenaCount + 1}`;
              const title = objectLayer.name;
              const w = obj.width || 80;
              const h = obj.height || 80;

              const zone = this.add.zone(obj.x + w / 2, obj.y + h / 2, w, h);
              zone.setInteractive({ useHandCursor: true });
              zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                pointer.event.stopPropagation();
                if (this.onBoardClick) this.onBoardClick(id, title);
              });

              this.arenas.push({ id, name: obj.name || objectLayer.name, title, x: obj.x, y: obj.y, width: w, height: h, zone });
              arenaCount++;
            }
          });
        }
      });
    }

    console.log(`[Interactives] Total chess arenas detected: ${arenaCount}`);
  }

  private createPlayer(x: number, y: number) {
    this.player = this.physics.add.sprite(x, y, 'player_sprite', 0).setDepth(100);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    body.setSize(14, 14);
    body.setOffset(17, 30);

    if (this.collisionGroup) {
      this.physics.add.collider(this.player, this.collisionGroup);
    }
  }

  private createAnimations() {
    this.anims.create({
      key: 'idle_down',
      frames: this.anims.generateFrameNumbers('player_sprite', { start: 0, end: 5 }),
      frameRate: 6, repeat: -1,
    });
    this.anims.create({
      key: 'idle_up',
      frames: this.anims.generateFrameNumbers('player_sprite', { start: 6, end: 11 }),
      frameRate: 6, repeat: -1,
    });
    this.anims.create({
      key: 'idle_side',
      frames: this.anims.generateFrameNumbers('player_sprite', { start: 12, end: 17 }),
      frameRate: 6, repeat: -1,
    });
    this.anims.create({
      key: 'walk_down',
      frames: this.anims.generateFrameNumbers('player_sprite', { start: 18, end: 23 }),
      frameRate: 10, repeat: -1,
    });
    this.anims.create({
      key: 'walk_up',
      frames: this.anims.generateFrameNumbers('player_sprite', { start: 24, end: 29 }),
      frameRate: 10, repeat: -1,
    });
    this.anims.create({
      key: 'walk_side',
      frames: this.anims.generateFrameNumbers('player_sprite', { start: 30, end: 35 }),
      frameRate: 10, repeat: -1,
    });

    this.player.anims.play('idle_down', true);
  }

  // --- Public API ---

  public setLocalPlayer(playerId: string, region: string) {
    this.localPlayerId = playerId;
    this.localRegion = region;
  }

  public setMovementSender(sender: MovementSender) {
    this.movementSender = sender;
  }

  public getPlayerPosition(): { x: number; y: number } {
    return this.player ? { x: this.player.x, y: this.player.y } : { x: 800, y: 640 };
  }

  public getArenas(): ChessArenaZone[] {
    return this.arenas;
  }

  public handlePlayerJoined(p: { id: string; socketId: string; username: string; rating: number; region: string; x: number; y: number; targetX: number; targetY: number; direction: string; isMoving: boolean }) {
    if (p.id === this.localPlayerId) return;
    const sessionId = p.socketId;
    if (this.otherPlayers.has(sessionId)) return;
    this.addRemotePlayer(sessionId, p);
  }

  public handlePlayerLeftBySession(sessionId: string) {
    const remote = this.otherPlayers.get(sessionId);
    if (remote) {
      remote.container.destroy();
      this.otherPlayers.delete(sessionId);
    }
  }

  public updateRemotePlayerState(sessionId: string, state: { x: number; y: number; targetX: number; targetY: number; direction: string; isMoving: boolean }) {
    const remote = this.otherPlayers.get(sessionId);
    if (!remote) return;
    remote.interpolator.pushSnapshot(state.x, state.y);
    remote.direction = state.direction;
    remote.isMoving = state.isMoving;
  }

  private addRemotePlayer(sessionId: string, p: { id: string; username: string; rating: number; x: number; y: number; direction: string; isMoving: boolean }) {
    const c = this.add.container(p.x, p.y).setDepth(99);
    const s = this.add.sprite(0, 0, 'player_sprite', 0);
    s.anims.play('idle_down', true);
    c.add(s);

    const nameText = this.add.text(0, -30, p.username, {
      fontSize: '8px',
      color: '#fff',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5);
    c.add(nameText);

    const ratingText = this.add.text(0, -20, `${p.rating}`, {
      fontSize: '7px',
      color: '#ffd700',
      stroke: '#000',
      strokeThickness: 1,
    }).setOrigin(0.5);
    c.add(ratingText);

    c.setSize(48, 48);
    c.setInteractive(new Phaser.Geom.Rectangle(-24, -24, 48, 48), Phaser.Geom.Rectangle.Contains);
    c.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      if (this.onPlayerClick) this.onPlayerClick(p.id);
    });

    const interpolator = new RemotePlayerInterpolator(p.x, p.y);
    this.otherPlayers.set(sessionId, {
      container: c,
      sprite: s,
      nameText,
      interpolator,
      direction: p.direction,
      isMoving: p.isMoving,
      sessionId,
      playerId: p.id,
    });
  }

  public updateBoardStatus(arenaId: string, status: string, info?: { playerName?: string; timeLabel?: string }) {
    const arena = this.arenas.find(a => a.id === arenaId || a.title === arenaId || a.name === arenaId);
    if (!arena) return;

    if (arena.statusIndicator) {
      arena.statusIndicator.destroy();
      arena.statusIndicator = undefined;
    }

    const cx = arena.x + arena.width / 2;
    const cy = arena.y + arena.height / 2;

    if (status === 'waiting') {
      const container = this.add.container(cx, cy - 24).setDepth(150);
      const bannerW = Math.max(arena.width + 16, 80);
      const bannerH = info?.playerName ? 28 : 16;
      const bg = this.add.graphics();
      bg.fillStyle(0xd97706, 0.92);
      bg.fillRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 3);
      bg.lineStyle(1, 0xfbbf24, 1);
      bg.strokeRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 3);

      const label = this.add.text(0, info?.playerName ? -5 : 0, 'Waiting for duel', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#ffffff',
        resolution: 2,
      }).setOrigin(0.5);
      container.add([bg, label]);

      if (info?.playerName) {
        const subText = info.timeLabel ? `${info.playerName} - ${info.timeLabel}` : info.playerName;
        const sub = this.add.text(0, 7, subText, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '7px',
          color: '#fde68a',
          resolution: 2,
        }).setOrigin(0.5);
        container.add(sub);
      }

      this.tweens.add({
        targets: container,
        alpha: { from: 1, to: 0.7 },
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      arena.statusIndicator = container;
    } else if (status === 'in_match') {
      const container = this.add.container(cx, cy - 20).setDepth(150);
      const bannerW = Math.max(arena.width + 8, 70);
      const bannerH = 16;
      const bg = this.add.graphics();
      bg.fillStyle(0x1d4ed8, 0.92);
      bg.fillRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 3);
      bg.lineStyle(1, 0x60a5fa, 1);
      bg.strokeRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 3);

      const label = this.add.text(0, 0, 'In match', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#ffffff',
        resolution: 2,
      }).setOrigin(0.5);

      container.add([bg, label]);
      arena.statusIndicator = container;
    }
  }

  public movePlayerToBoard(arenaId: string, side: 'left' | 'right') {
    const arena = this.arenas.find(a => a.id === arenaId || a.title === arenaId);
    if (!arena || !this.player) return;

    const centerY = arena.y + arena.height / 2;
    const targetX = side === 'left' ? arena.x - 16 : arena.x + arena.width + 16;

    this.movementLocked = true;
    this.target = null;
    if (this.player.body) {
      (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0);
    }

    this.tweens.add({
      targets: this.player,
      x: targetX,
      y: centerY,
      duration: 500,
      ease: 'Power2',
      onComplete: () => {
        if (side === 'left') {
          this.player.anims.play('idle_side', true);
          this.player.setFlipX(false);
        } else {
          this.player.anims.play('idle_side', true);
          this.player.setFlipX(true);
        }
      },
    });

    this.cameras.main.zoomTo(this.boardZoom, 500, 'Power2');
    this.cameras.main.pan(arena.x + arena.width / 2, arena.y + arena.height / 2, 500, 'Power2');
  }

  public lockMovement(arenaId?: string) {
    this.movementLocked = true;
    this.target = null;
    if (this.player?.body) {
      (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0);
    }
    this.player?.anims.play('idle_down', true);

    if (arenaId) {
      const arena = this.arenas.find(a => a.id === arenaId);
      if (arena) {
        this.movePlayerToBoard(arenaId, 'left');
      }
    }
  }

  public unlockMovement() {
    this.movementLocked = false;
    this.cameras.main.zoomTo(this.defaultZoom, 300, 'Power2');
    if (this.player) {
      this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    }
  }
}
