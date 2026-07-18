import Phaser from 'phaser';
import decomp from 'poly-decomp';
import { MAP_CONFIG } from '../config/mapConfig';
import { WORLD_TILESETS, findTilesetForGid } from '../config/worldAssets';
import {
  getCharacter,
  getIdleFrame,
  getAnimKey,
  Direction8,
} from '../characters/characterCatalog';
import { RemotePlayerInterpolator } from '../network/interpolation';
import AStarGrid from '../pathfinding/AStarGrid';

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
  private pathWaypoints: { x: number; y: number }[] = [];
  private currentWaypointIndex = 0;
  private arenas: ChessArenaZone[] = [];
  private otherPlayers: Map<string, RemotePlayer> = new Map();
  private localPlayerId: string = '';

  private lastSentTime = 0;
  private readonly SEND_INTERVAL = 50;
  private movementLocked = false;
  private defaultZoom = MAP_CONFIG.zoom.default;
  private boardZoom = MAP_CONFIG.zoom.board;
  private movementSender: MovementSender | null = null;
  private currentDirection: Direction8 = 'down';
  private playerSpeed = MAP_CONFIG.playerSpeed;
  private pathfinder!: AStarGrid;
  private collisionRects: { x: number; y: number; width: number; height: number }[] = [];
  private collisionPolys: { x: number; y: number }[][] = [];
  private stuckFrames = 0;
  private lastStuckPos: { x: number; y: number } | null = null;
  private readonly STUCK_THRESHOLD = 30;

  // Zoom state
  private targetZoom = MAP_CONFIG.zoom.default;
  private pinchStartDistance = 0;
  private pinchStartZoom = 0;
  private isPinching = false;

  public onBoardClick?: (arenaId: string, arenaTitle: string) => void;
  public onHouseClick?: (houseId: string) => void;
  public onPositionUpdate?: (x: number, y: number) => void;
  public onPlayerClick?: (userId: string) => void;

  constructor() {
    super({ key: 'WorldScene' });
  }

  preload() {
    (window as any).decomp = decomp;

    this.load.tilemapTiledJSON(MAP_CONFIG.key, MAP_CONFIG.path);

    const charDef = getCharacter();
    this.load.spritesheet(charDef.id, charDef.sheet, {
      frameWidth: charDef.frameWidth,
      frameHeight: charDef.frameHeight,
    });

    for (const ts of WORLD_TILESETS) {
      this.load.image(ts.textureKey, MAP_CONFIG.basePath + ts.image);
    }
  }

  create() {
    const map = this.make.tilemap({ key: MAP_CONFIG.key });

    // Add regular tilesets (spritesheet-based, with top-level image in TMJ)
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of WORLD_TILESETS) {
      if (ts.isSingleImage) continue;
      const added = map.addTilesetImage(ts.tiledName, ts.textureKey);
      if (added) tilesets.push(added);
    }

    const logicalSet = new Set(MAP_CONFIG.logicalLayers.map(l => l.toLowerCase()));

    // Build visibility map from raw TMJ data to skip hidden layers/groups
    const hiddenLayerIndices = this.getHiddenTileLayerIndices();

    // Create ALL tile layers by index to handle duplicate names
    for (let i = 0; i < map.layers.length; i++) {
      const layerData = map.layers[i];
      const lowerName = layerData.name.toLowerCase();

      // Skip logical layers (check both full name and last segment)
      const shortName = lowerName.split('/').pop() || lowerName;
      if (logicalSet.has(lowerName) || logicalSet.has(shortName)) continue;

      // Skip hidden layers (marked visible:false in Tiled or inside hidden groups)
      if (hiddenLayerIndices.has(i)) continue;

      // Skip if already created
      if (layerData.tilemapLayer) continue;

      const layer = map.createLayer(i, tilesets);
      if (layer) {
        const isAbove = lowerName.includes('visual_above/') || lowerName.includes('(above)');
        layer.setDepth(isAbove ? 200 : 0);
      }
    }

    // Render GID-based tile objects (from ImageCollections) as sprites
    this.renderTileObjects(map, logicalSet);

    // Set up Matter world bounds
    this.matter.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Load collisions from raw TMJ (handles nested groups correctly)
    this.setupCollisionsFromTMJ();

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

    // Build pathfinding grid
    this.buildPathfindingGrid(map.widthInPixels, map.heightInPixels);

    // Click-to-move with pathfinding
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.movementLocked) return;
      if (this.isPinching) return;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.navigateTo(worldPoint.x, worldPoint.y);
    });

    // Setup zoom controls
    this.setupZoom();
  }

  private setupZoom() {
    const { min, max, step } = MAP_CONFIG.zoom;

    // Desktop: mouse wheel / trackpad scroll zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any[], _deltaX: number, deltaY: number) => {
      if (this.movementLocked) return;
      const direction = deltaY > 0 ? -1 : 1;
      this.targetZoom = Phaser.Math.Clamp(
        this.targetZoom + direction * step,
        min,
        max
      );
    });

    // Mobile: pinch-to-zoom
    this.input.addPointer(1); // enable 2nd pointer for multi-touch

    this.input.on('pointerdown', () => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        this.isPinching = true;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        this.pinchStartDistance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.pinchStartZoom = this.targetZoom;
      }
    });

    this.input.on('pointermove', () => {
      if (!this.isPinching) return;
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) {
        this.isPinching = false;
        return;
      }
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      const currentDistance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      const scale = currentDistance / this.pinchStartDistance;
      this.targetZoom = Phaser.Math.Clamp(
        this.pinchStartZoom * scale,
        min,
        max
      );
    });

    this.input.on('pointerup', () => {
      if (this.isPinching) {
        if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) {
          this.isPinching = false;
        }
      }
    });
  }

  private renderTileObjects(_map: Phaser.Tilemaps.Tilemap, logicalSet: Set<string>) {
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    if (!tmjData) return;

    const processLayers = (layers: any[], isAbove: boolean) => {
      for (const layerData of layers) {
        const lowerName = layerData.name.toLowerCase();

        if (layerData.type === 'group') {
          const nowAbove = isAbove || lowerName === 'visual_above';
          processLayers(layerData.layers || [], nowAbove);
          continue;
        }

        if (layerData.type !== 'objectgroup') continue;
        if (logicalSet.has(lowerName)) continue;

        for (const obj of (layerData.objects || [])) {
          if (!obj.gid || obj.visible === false) continue;

          const rawGid = obj.gid;
          const tsDef = findTilesetForGid(rawGid);
          if (!tsDef || !tsDef.isSingleImage) continue;

          const sprite = this.add.sprite(obj.x, obj.y, tsDef.textureKey);
          sprite.setOrigin(0, 1); // Tiled tile objects have origin at bottom-left
          sprite.setDisplaySize(obj.width || 32, obj.height || 32);
          sprite.setDepth(isAbove ? 200 : (obj.y || 0));

          // Handle flip flags encoded in GID
          const FLIPPED_H = 0x80000000;
          const FLIPPED_V = 0x40000000;
          if (rawGid & FLIPPED_H) sprite.setFlipX(true);
          if (rawGid & FLIPPED_V) sprite.setFlipY(true);
        }
      }
    };

    processLayers(tmjData.layers || [], false);
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
    return { x: 1273, y: 926 };
  }

  private getHiddenTileLayerIndices(): Set<number> {
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    if (!tmjData) return new Set();

    const hidden = new Set<number>();
    let idx = 0;

    const walk = (layers: any[], parentVisible: boolean) => {
      for (const l of layers) {
        const selfVisible = l.visible !== false;
        const effectivelyVisible = parentVisible && selfVisible;

        if (l.type === 'group') {
          walk(l.layers || [], effectivelyVisible);
        } else if (l.type === 'tilelayer') {
          if (!effectivelyVisible) hidden.add(idx);
          idx++;
        }
      }
    };

    walk(tmjData.layers || [], true);
    return hidden;
  }

  private setupCollisionsFromTMJ() {
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    if (!tmjData) return;

    const collisionObjects = this.findObjectLayerInTMJ(tmjData.layers, 'collisions');
    if (!collisionObjects) return;

    for (const obj of collisionObjects) {
      const props: any[] = obj.properties || [];
      const labelData: Record<string, string> = {};
      for (const p of props) {
        labelData[p.name] = String(p.value);
      }
      const label = obj.name || `collision_${obj.id}`;

      if (obj.polygon) {
        const absoluteVerts = obj.polygon.map((p: { x: number; y: number }) => ({
          x: obj.x + p.x,
          y: obj.y + p.y,
        }));
        this.collisionPolys.push(absoluteVerts);
        this.createPolygonBodies(absoluteVerts, labelData, label);
      } else if (obj.width && obj.height) {
        this.collisionRects.push({ x: obj.x, y: obj.y, width: obj.width, height: obj.height });
        this.createRectBody(obj, labelData, label);
      }
    }
  }

  private findObjectLayerInTMJ(layers: any[], name: string): any[] | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findObjectLayerInTMJ(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup' && l.name.toLowerCase() === name.toLowerCase()) {
        return l.objects || [];
      }
    }
    return null;
  }

  private createRectBody(obj: any, labelData: Record<string, string>, label: string) {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    this.matter.add.rectangle(cx, cy, obj.width, obj.height, {
      isStatic: true,
      label,
      // @ts-ignore
      customData: labelData,
    });
  }

  private createPolygonBodies(absoluteVerts: { x: number; y: number }[], labelData: Record<string, string>, label: string) {
    if (absoluteVerts.length < 3) return;

    // Convert to poly-decomp format [x, y][]
    const poly = absoluteVerts.map(v => [v.x, v.y] as [number, number]);

    try {
      decomp.makeCCW(poly);
      decomp.removeCollinearPoints(poly, 0.01);
      if (poly.length < 3) {
        this.createConvexBody(absoluteVerts, labelData, label);
        return;
      }

      const convexParts = decomp.quickDecomp(poly);
      if (!convexParts || convexParts.length === 0) {
        this.createConvexBody(absoluteVerts, labelData, label);
        return;
      }

      for (let i = 0; i < convexParts.length; i++) {
        const part = convexParts[i];
        if (part.length < 3) continue;

        const partVerts = part.map((p: number[]) => ({ x: p[0], y: p[1] }));
        this.createConvexBody(partVerts, labelData, `${label}_p${i}`);
      }
    } catch (e) {
      this.createConvexBody(absoluteVerts, labelData, label);
    }
  }

  private createConvexBody(verts: { x: number; y: number }[], labelData: Record<string, string>, label: string) {
    if (verts.length < 3) return;

    // Compute centroid
    let cx = 0, cy = 0;
    for (const v of verts) { cx += v.x; cy += v.y; }
    cx /= verts.length;
    cy /= verts.length;

    // Make vertices relative to centroid for Matter.js
    const relVerts = verts.map(v => ({ x: v.x - cx, y: v.y - cy }));

    // For convex shapes, fromVertices works reliably: single part, no decomposition needed
    const body = this.matter.add.fromVertices(cx, cy, [relVerts], {
      isStatic: true,
      label,
      // @ts-ignore
      customData: labelData,
    });

    if (body) {
      // Correct for center-of-mass offset: the body position should align the
      // vertices to their intended absolute positions.
      // After fromVertices, body.position is at the center of mass (which equals cx,cy
      // for single convex parts). We need to verify vertex alignment.
      // For single-part convex bodies, body.bounds gives us the actual bounds.
      const actualCx = (body.bounds.min.x + body.bounds.max.x) / 2;
      const actualCy = (body.bounds.min.y + body.bounds.max.y) / 2;

      // Expected bounds center from our input vertices
      const xs = verts.map(v => v.x);
      const ys = verts.map(v => v.y);
      const expectedCx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const expectedCy = (Math.min(...ys) + Math.max(...ys)) / 2;

      const offsetX = expectedCx - actualCx;
      const offsetY = expectedCy - actualCy;

      if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
        this.matter.body.setPosition(body, {
          x: body.position.x + offsetX,
          y: body.position.y + offsetY,
        });
      }
    }
  }

  private buildPathfindingGrid(mapWidth: number, mapHeight: number) {
    this.pathfinder = new AStarGrid(16);
    // Inflate obstacles by player body half-width (6px) to prevent wall-hugging paths
    this.pathfinder.buildGrid(mapWidth, mapHeight, this.collisionRects, this.collisionPolys, 8);
  }

  private navigateTo(worldX: number, worldY: number) {
    const startX = this.playerBody.position.x;
    const startY = this.playerBody.position.y;

    this.stuckFrames = 0;
    this.lastStuckPos = null;

    const waypoints = this.pathfinder.findPath(startX, startY, worldX, worldY);
    if (waypoints.length > 1) {
      this.pathWaypoints = waypoints;
      // Replace last waypoint with exact click position if it's close enough
      const lastWp = waypoints[waypoints.length - 1];
      const dToClick = Math.hypot(lastWp.x - worldX, lastWp.y - worldY);
      if (dToClick < 24) {
        this.pathWaypoints[this.pathWaypoints.length - 1] = { x: worldX, y: worldY };
      }
      this.currentWaypointIndex = 1;
      this.target = this.pathWaypoints[this.currentWaypointIndex];
    } else {
      // Direct movement to click point
      this.pathWaypoints = [];
      this.currentWaypointIndex = 0;
      this.target = { x: worldX, y: worldY };
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
  }

  private createPlayer(x: number, y: number) {
    const charDef = getCharacter();

    this.player = this.add.sprite(x, y, charDef.id, 0);
    this.player.setScale(charDef.scale);
    this.player.setOrigin(charDef.originX, charDef.originY);
    this.player.setDepth(100);

    // Body sized to match the visible character, not the full frame.
    // The visible character within a 104x104 frame is approximately 30px wide and 50px tall.
    // At 0.45 scale that's ~13.5px x 22.5px. We use a small rect at the feet area for collisions.
    const bodyW = 12;
    const bodyH = 8;
    // Body sits at the character's feet. Offset from sprite origin.
    // With originY 0.82, the feet are at ~82% of the rendered height.
    // The body should be at the world position of the feet.
    const feetOffsetY = 4; // Small offset below the sprite draw position to align with feet

    this.playerBody = this.matter.add.rectangle(
      x, y + feetOffsetY,
      bodyW, bodyH,
      {
        label: 'player',
        friction: 0,
        frictionAir: 0.15,
        frictionStatic: 0,
        chamfer: { radius: 3 },
      }
    );
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

    // Smooth zoom interpolation
    const currentZoom = this.cameras.main.zoom;
    if (Math.abs(currentZoom - this.targetZoom) > 0.001) {
      const newZoom = Phaser.Math.Linear(currentZoom, this.targetZoom, MAP_CONFIG.zoom.smoothSpeed * 2);
      this.cameras.main.setZoom(newZoom);
    }

    this.player.x = this.playerBody.position.x;
    this.player.y = this.playerBody.position.y - 4;

    this.otherPlayers.forEach((remote) => {
      const pos = remote.interpolator.getPosition();
      remote.container.x = pos.x;
      remote.container.y = pos.y;
      if (remote.isMoving) {
        remote.sprite.anims.play(getAnimKey(remote.direction), true);
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

    // Stuck detection: if the player hasn't moved significantly, reroute or give up
    if (this.lastStuckPos) {
      const movedDist = Math.hypot(bx - this.lastStuckPos.x, by - this.lastStuckPos.y);
      if (movedDist < 0.5) {
        this.stuckFrames++;
        if (this.stuckFrames >= this.STUCK_THRESHOLD) {
          // Player is stuck - skip current waypoint or give up
          if (this.pathWaypoints.length > 0 && this.currentWaypointIndex < this.pathWaypoints.length - 1) {
            // Try skipping to the next waypoint
            this.currentWaypointIndex++;
            this.target = this.pathWaypoints[this.currentWaypointIndex];
            this.stuckFrames = 0;
          } else {
            // Give up on this path
            this.target = null;
            this.pathWaypoints = [];
            this.currentWaypointIndex = 0;
            this.stuckFrames = 0;
            this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
            this.player.anims.stop();
            this.player.setFrame(getIdleFrame(this.currentDirection));
            this.emitMovement(false);
            return;
          }
        }
      } else {
        this.stuckFrames = 0;
      }
    }
    this.lastStuckPos = { x: bx, y: by };

    const dx = this.target.x - bx;
    const dy = this.target.y - by;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const arrivalThreshold = 6;
    if (dist < arrivalThreshold) {
      // Advance to the next waypoint if available
      if (this.pathWaypoints.length > 0 && this.currentWaypointIndex < this.pathWaypoints.length - 1) {
        this.currentWaypointIndex++;
        this.target = this.pathWaypoints[this.currentWaypointIndex];
      } else {
        // Reached final destination
        this.target = null;
        this.pathWaypoints = [];
        this.currentWaypointIndex = 0;
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
        this.emitMovement(false);
        if (this.onPositionUpdate) this.onPositionUpdate(this.player.x, this.player.y);
        return;
      }
    }

    // Move towards current target
    const tdx = this.target.x - bx;
    const tdy = this.target.y - by;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tdist < 0.1) return;

    const vx = (tdx / tdist) * this.playerSpeed;
    const vy = (tdy / tdist) * this.playerSpeed;
    this.matter.body.setVelocity(this.playerBody, { x: vx, y: vy });

    const dir = this.getDirection8(tdx, tdy);
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
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });

    this.tweens.add({
      targets: this.playerBody.position,
      x: targetX,
      y: centerY,
      duration: 500,
      ease: 'Power2',
      onUpdate: () => {
        this.player.x = this.playerBody.position.x;
        this.player.y = this.playerBody.position.y - 4;
      },
      onComplete: () => {
        this.currentDirection = side === 'left' ? 'right' : 'left';
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
      },
    });

    this.targetZoom = this.boardZoom;
    this.cameras.main.zoomTo(this.boardZoom, 500, 'Power2');
    this.cameras.main.pan(arena.x + arena.width / 2, arena.y + arena.height / 2, 500, 'Power2');
  }

  public lockMovement(arenaId?: string) {
    this.movementLocked = true;
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
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
    this.targetZoom = this.defaultZoom;
    this.cameras.main.zoomTo(this.defaultZoom, 300, 'Power2');
    if (this.player) {
      this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    }
  }
}
