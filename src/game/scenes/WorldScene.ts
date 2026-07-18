import Phaser from 'phaser';
import decomp from 'poly-decomp';
import { MAP_CONFIG } from '../config/mapConfig';
import { WORLD_TILESETS } from '../config/worldAssets';
import {
  getCharacter,
  getIdleFrame,
  getAnimKey,
  Direction8,
} from '../characters/characterCatalog';
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
  direction: Direction8;
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
  private playerBody!: MatterJS.BodyType;
  private target: { x: number; y: number } | null = null;
  private arenas: ChessArenaZone[] = [];
  private otherPlayers: Map<string, RemotePlayer> = new Map();
  private localPlayerId: string = '';

  private lastSentTime = 0;
  private readonly SEND_INTERVAL = 50;
  private movementLocked = false;
  private defaultZoom = 2;
  private boardZoom = 3;
  private movementSender: MovementSender | null = null;
  private currentDirection: Direction8 = 'down';
  private playerSpeed = 3;


  public onBoardClick?: (arenaId: string, arenaTitle: string) => void;
  public onHouseClick?: (houseId: string) => void;
  public onPositionUpdate?: (x: number, y: number) => void;
  public onPlayerClick?: (userId: string) => void;

  constructor() {
    super({ key: 'WorldScene' });
  }

  preload() {
    // Register poly-decomp for concave polygon support
    (window as any).decomp = decomp;

    this.load.tilemapTiledJSON(MAP_CONFIG.key, MAP_CONFIG.path);

    const charDef = getCharacter();
    this.load.spritesheet(charDef.id, charDef.sheet, {
      frameWidth: charDef.frameWidth,
      frameHeight: charDef.frameHeight,
    });

    for (const ts of WORLD_TILESETS) {
      this.load.image(ts.name, MAP_CONFIG.basePath + ts.image);
    }
  }

  create() {
    const map = this.make.tilemap({ key: MAP_CONFIG.key });

    // Add all tilesets
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of WORLD_TILESETS) {
      const added = map.addTilesetImage(ts.name, ts.name);
      if (added) tilesets.push(added);
    }

    const logicalSet = new Set(MAP_CONFIG.logicalLayers.map(l => l.toLowerCase()));

    // Create tile layers (skip logical layers)
    map.layers.forEach((layerData) => {
      const lowerName = layerData.name.toLowerCase();
      if (logicalSet.has(lowerName)) return;
      const layer = map.createLayer(layerData.name, tilesets);
      if (layer) {
        layer.setDepth(this.getLayerDepth(layerData.name, map));
      }
    });

    // Process layer groups — render tile layers and tile objects
    this.renderGroupedLayers(map, tilesets, logicalSet);

    // Set up Matter world bounds
    this.matter.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Load collisions from object layer
    this.setupCollisions(map);

    // Setup chess table interactives
    this.setupInteractives(map);

    // Create player at spawn point
    const spawnPoint = this.findSpawnPoint(map);
    this.createPlayer(spawnPoint.x, spawnPoint.y);
    this.createAnimations();

    // Camera
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(this.defaultZoom);
    this.cameras.main.setRoundPixels(true);

    // Click-to-move
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.movementLocked) return;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.target = { x: worldPoint.x, y: worldPoint.y };
    });
  }

  private renderGroupedLayers(
    map: Phaser.Tilemaps.Tilemap,
    _tilesets: Phaser.Tilemaps.Tileset[],
    logicalSet: Set<string>,
  ) {
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    if (!tmjData) return;

    const processLayers = (layers: any[], isAbove: boolean, groupPrefix: string) => {
      for (const layerData of layers) {
        const fullName = groupPrefix ? `${groupPrefix}/${layerData.name}` : layerData.name;
        const lowerName = layerData.name.toLowerCase();

        if (logicalSet.has(lowerName)) continue;

        if (layerData.type === 'group') {
          const nowAbove = isAbove || lowerName === 'visual_above';
          processLayers(layerData.layers || [], nowAbove, fullName);
        } else if (layerData.type === 'tilelayer') {
          // Already handled by Phaser's flat layer creation
        } else if (layerData.type === 'objectgroup') {
          if (logicalSet.has(lowerName)) continue;
          // Render tile objects (GID-based)
          const objLayer = map.objects.find(
            (ol) => ol.name === layerData.name || ol.name === fullName.split('/').pop()
          );
          if (objLayer) {
            for (const obj of objLayer.objects) {
              if (obj.gid && obj.visible !== false) {
                const created = map.createFromObjects(objLayer.name, { id: obj.id });
                if (created && created.length > 0) {
                  for (const go of created) {
                    (go as any).setDepth?.(isAbove ? 200 : (obj.y || 0));
                  }
                }
              }
            }
          }
        }
      }
    };

    processLayers(tmjData.layers || [], false, '');
  }

  private getLayerDepth(layerName: string, _map: Phaser.Tilemaps.Tilemap): number {
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    if (!tmjData) return 0;

    const isInAboveGroup = this.isLayerInGroup(layerName, 'VISUAL_ABOVE', tmjData.layers);
    if (isInAboveGroup) return 200;
    return 0;
  }

  private isLayerInGroup(layerName: string, groupName: string, layers: any[]): boolean {
    for (const l of layers) {
      if (l.type === 'group' && l.name === groupName) {
        return this.containsLayer(layerName, l.layers || []);
      }
      if (l.type === 'group' && l.layers) {
        if (this.isLayerInGroup(layerName, groupName, l.layers)) return true;
      }
    }
    return false;
  }

  private containsLayer(name: string, layers: any[]): boolean {
    for (const l of layers) {
      if (l.name === name) return true;
      if (l.layers && this.containsLayer(name, l.layers)) return true;
    }
    return false;
  }

  private findSpawnPoint(map: Phaser.Tilemaps.Tilemap): { x: number; y: number } {
    const spawnLayer = map.objects.find(l => l.name.toLowerCase() === 'spawns');
    if (spawnLayer) {
      const spawnObj = spawnLayer.objects.find((o) => {
        const props: any[] = (o as any).properties || [];
        const spawnId = props.find((p: any) => p.name === 'spawnId')?.value;
        return spawnId === 'main_player_spawn' || o.name === 'main_player_spawn';
      });
      if (spawnObj && spawnObj.x !== undefined && spawnObj.y !== undefined) {
        return { x: spawnObj.x, y: spawnObj.y };
      }
    }
    console.error('[WorldScene] main_player_spawn not found, using fallback');
    return { x: 1273, y: 926 };
  }

  private setupCollisions(map: Phaser.Tilemaps.Tilemap) {
    const collisionLayer = map.objects.find(l => l.name.toLowerCase() === 'collisions');
    if (!collisionLayer) return;

    for (const obj of collisionLayer.objects) {
      const props: any[] = (obj as any).properties || [];
      const labelData: Record<string, string> = {};
      for (const p of props) {
        labelData[p.name] = String(p.value);
      }
      const label = obj.name || `collision_${obj.id}`;

      if ((obj as any).polygon) {
        this.createPolygonBody(obj, labelData, label);
      } else if (obj.width && obj.height) {
        this.createRectBody(obj, labelData, label);
      }
    }
  }

  private createRectBody(obj: any, labelData: Record<string, string>, label: string) {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    this.matter.add.rectangle(cx, cy, obj.width, obj.height, {
      isStatic: true,
      label,
      // @ts-ignore - store custom data
      customData: labelData,
    });
  }

  private createPolygonBody(obj: any, labelData: Record<string, string>, label: string) {
    const polygon: { x: number; y: number }[] = obj.polygon;
    if (!polygon || polygon.length < 3) return;

    const vertices = polygon.map((p: { x: number; y: number }) => ({
      x: p.x,
      y: p.y,
    }));

    const cx = obj.x + vertices.reduce((s: number, v: { x: number }) => s + v.x, 0) / vertices.length;
    const cy = obj.y + vertices.reduce((s: number, v: { y: number }) => s + v.y, 0) / vertices.length;

    const centeredVerts = vertices.map((v: { x: number; y: number }) => ({
      x: v.x - (cx - obj.x),
      y: v.y - (cy - obj.y),
    }));

    try {
      const body = this.matter.add.fromVertices(cx, cy, [centeredVerts], {
        isStatic: true,
        label,
        // @ts-ignore
        customData: labelData,
      });
      if (!body) {
        // Fallback: bounding box
        const minX = Math.min(...vertices.map((v: { x: number }) => v.x));
        const maxX = Math.max(...vertices.map((v: { x: number }) => v.x));
        const minY = Math.min(...vertices.map((v: { y: number }) => v.y));
        const maxY = Math.max(...vertices.map((v: { y: number }) => v.y));
        const w = maxX - minX;
        const h = maxY - minY;
        const bcx = obj.x + minX + w / 2;
        const bcy = obj.y + minY + h / 2;
        this.matter.add.rectangle(bcx, bcy, w, h, {
          isStatic: true,
          label: label + '_bbox',
          // @ts-ignore
          customData: labelData,
        });
      }
    } catch (e) {
      console.warn(`[Collision] Failed to create polygon for "${label}":`, e);
    }
  }

  private setupInteractives(map: Phaser.Tilemaps.Tilemap) {
    const ctLayer = map.objects.find(l => l.name === 'chess_tables_interactions');
    if (!ctLayer) return;

    let arenaCount = 0;
    for (const obj of ctLayer.objects) {
      const objName = obj.name || '';
      if (!objName.includes('_board')) continue;

      const props: any[] = (obj as any).properties || [];
      const tableId = props.find((p: any) => p.name === 'tableId')?.value || '';
      const id = tableId || `arena_${arenaCount + 1}`;
      const title = objName;
      const w = obj.width || 80;
      const h = obj.height || 80;
      const x = obj.x || 0;
      const y = obj.y || 0;

      const zone = this.add.zone(x + w / 2, y + h / 2, w, h);
      zone.setInteractive({ useHandCursor: true });
      zone.setDepth(50);
      zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        if (this.onBoardClick) this.onBoardClick(id, title);
      });

      this.arenas.push({ id, name: objName, title, x, y, width: w, height: h, zone });
      arenaCount++;
    }
    console.log(`[Interactives] Total chess arenas detected: ${arenaCount}`);
  }

  private createPlayer(x: number, y: number) {
    const charDef = getCharacter();

    this.player = this.add.sprite(x, y, charDef.id, 0);
    this.player.setScale(charDef.scale);
    this.player.setOrigin(charDef.originX, charDef.originY);
    this.player.setDepth(100);

    this.playerBody = this.matter.add.rectangle(
      x, y + charDef.bodyOffsetY,
      charDef.bodyWidth, charDef.bodyHeight,
      {
        label: 'player',
        friction: 0,
        frictionAir: 0.15,
        frictionStatic: 0,
      }
    );
    // Prevent rotation
    this.matter.body.setInertia(this.playerBody, Infinity);
  }

  private createAnimations() {
    const charDef = getCharacter();
    for (let i = 0; i < charDef.directions.length; i++) {
      const dir = charDef.directions[i];
      const start = i * charDef.framesPerDirection;
      const end = start + charDef.framesPerDirection - 1;
      this.anims.create({
        key: getAnimKey(dir),
        frames: this.anims.generateFrameNumbers(charDef.id, { start, end }),
        frameRate: 9,
        repeat: -1,
      });
    }
  }

  update() {
    if (!this.player || !this.playerBody) return;

    // Sync sprite to body
    this.player.x = this.playerBody.position.x;
    this.player.y = this.playerBody.position.y - getCharacter().bodyOffsetY;

    // Update remote players
    this.otherPlayers.forEach((remote) => {
      const pos = remote.interpolator.getPosition();
      remote.container.x = pos.x;
      remote.container.y = pos.y;
      if (remote.isMoving) {
        const animKey = getAnimKey(remote.direction);
        remote.sprite.anims.play(animKey, true);
      } else {
        remote.sprite.anims.stop();
        remote.sprite.setFrame(getIdleFrame(remote.direction));
      }
    });

    if (!this.target) {
      if (this.playerBody.speed > 0.1) {
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
        this.emitMovement(false);
      }
      return;
    }

    const bx = this.playerBody.position.x;
    const by = this.playerBody.position.y;
    const dx = this.target.x - bx;
    const dy = this.target.y - by;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 6) {
      this.target = null;
      this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
      this.player.anims.stop();
      this.player.setFrame(getIdleFrame(this.currentDirection));
      this.emitMovement(false);
      if (this.onPositionUpdate) this.onPositionUpdate(this.player.x, this.player.y);
      return;
    }

    // Normalize and set velocity
    const vx = (dx / dist) * this.playerSpeed;
    const vy = (dy / dist) * this.playerSpeed;
    this.matter.body.setVelocity(this.playerBody, { x: vx, y: vy });

    // Determine 8-direction
    const dir = this.getDirection8(dx, dy);
    this.currentDirection = dir;
    this.player.anims.play(getAnimKey(dir), true);

    const now = Date.now();
    if (now - this.lastSentTime >= this.SEND_INTERVAL) {
      this.emitMovement(true, dir);
      this.lastSentTime = now;
    }

    if (this.onPositionUpdate && this.game.loop.frame % 30 === 0) {
      this.onPositionUpdate(this.player.x, this.player.y);
    }
  }

  private getDirection8(dx: number, dy: number): Direction8 {
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    // angle: -180 to 180, 0 = right
    if (angle >= -22.5 && angle < 22.5) return 'right';
    if (angle >= 22.5 && angle < 67.5) return 'down-right';
    if (angle >= 67.5 && angle < 112.5) return 'down';
    if (angle >= 112.5 && angle < 157.5) return 'down-left';
    if (angle >= 157.5 || angle < -157.5) return 'left';
    if (angle >= -157.5 && angle < -112.5) return 'up-left';
    if (angle >= -112.5 && angle < -67.5) return 'up';
    return 'up-right';
  }

  private emitMovement(isMoving: boolean, direction: Direction8 = this.currentDirection) {
    if (!this.movementSender) return;
    this.movementSender({
      x: this.playerBody.position.x,
      y: this.playerBody.position.y,
      targetX: this.target?.x ?? this.playerBody.position.x,
      targetY: this.target?.y ?? this.playerBody.position.y,
      direction,
      isMoving,
    });
  }

  // --- Public API ---

  public setLocalPlayer(playerId: string, _region: string) {
    this.localPlayerId = playerId;
  }

  public setMovementSender(sender: MovementSender) {
    this.movementSender = sender;
  }

  public getPlayerPosition(): { x: number; y: number } {
    if (this.playerBody) {
      return { x: this.playerBody.position.x, y: this.playerBody.position.y };
    }
    return { x: 1273, y: 926 };
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
    remote.direction = (state.direction as Direction8) || 'down';
    remote.isMoving = state.isMoving;
  }

  private addRemotePlayer(sessionId: string, p: { id: string; username: string; rating: number; x: number; y: number; direction: string; isMoving: boolean }) {
    const charDef = getCharacter();
    const c = this.add.container(p.x, p.y).setDepth(99);
    const s = this.add.sprite(0, 0, charDef.id, 0);
    s.setScale(charDef.scale);
    s.setOrigin(charDef.originX, charDef.originY);
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
    const direction = (p.direction as Direction8) || 'down';
    this.otherPlayers.set(sessionId, {
      container: c,
      sprite: s,
      nameText,
      interpolator,
      direction,
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
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });

    this.tweens.add({
      targets: this.playerBody.position,
      x: targetX,
      y: centerY,
      duration: 500,
      ease: 'Power2',
      onUpdate: () => {
        this.player.x = this.playerBody.position.x;
        this.player.y = this.playerBody.position.y - getCharacter().bodyOffsetY;
      },
      onComplete: () => {
        this.currentDirection = side === 'left' ? 'right' : 'left';
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
      },
    });

    this.cameras.main.zoomTo(this.boardZoom, 500, 'Power2');
    this.cameras.main.pan(arena.x + arena.width / 2, arena.y + arena.height / 2, 500, 'Power2');
  }

  public lockMovement(arenaId?: string) {
    this.movementLocked = true;
    this.target = null;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    this.player.anims.stop();
    this.player.setFrame(getIdleFrame(this.currentDirection));

    if (arenaId) {
      const arena = this.arenas.find(a => a.id === arenaId);
      if (arena) this.movePlayerToBoard(arenaId, 'left');
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
