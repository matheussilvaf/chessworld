import Phaser from 'phaser';
import decomp from 'poly-decomp';
import { MAP_CONFIG } from '../config/mapConfig';
import { WORLD_TILESETS, findTilesetForGid } from '../config/worldAssets';
import {
  getCharacter,
  getIdleFrame,
  getAnimKey,
  Direction8,
  getBodyConfig,
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

  // Debug graphics
  private debugGfx!: Phaser.GameObjects.Graphics;
  private clickMarker: { x: number; y: number } | null = null;
  private localPlayerId: string = '';

  private lastSentTime = 0;
  private readonly SEND_INTERVAL = 50;
  private movementLocked = false;
  private defaultZoom = MAP_CONFIG.zoom.default;
  private boardZoom = MAP_CONFIG.zoom.board;
  private movementSender: MovementSender | null = null;
  private currentDirection: Direction8 = 'down';
  private playerSpeed = MAP_CONFIG.playerSpeed;
  private playerFeetOffset = 0;
  private pathfinder!: AStarGrid;
  private collisionRects: { x: number; y: number; width: number; height: number }[] = [];
  private collisionPolys: { x: number; y: number }[][] = [];

  // Movement / pathfinding state
  private stuckFrames = 0;
  private lastStuckPos: { x: number; y: number } | null = null;
  private readonly STUCK_THRESHOLD = 10;
  private rerouteAttempts = 0;
  private readonly MAX_REROUTE_ATTEMPTS = 3;
  private finalDestination: { x: number; y: number } | null = null;

  // Zoom state
  private targetZoom = MAP_CONFIG.zoom.default;
  private pinchStartDistance = 0;
  private pinchStartZoom = 0;
  private isPinching = false;

  // Pixel-perfect camera state (manual follow, PPU-snapped)
  private cameraTargetX = 0;
  private cameraTargetY = 0;
  private cameraBounds = { x: 0, y: 0, w: 0, h: 0 };
  private cameraFollowing = true;

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

    // Enforce NEAREST filtering on all tileset textures to prevent tile bleeding
    for (const ts of WORLD_TILESETS) {
      const texture = this.textures.get(ts.textureKey);
      if (texture && texture.source.length > 0) {
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }

    const logicalSet = new Set(MAP_CONFIG.logicalLayers.map(l => l.toLowerCase()));

    // Build visibility map from raw TMJ data to skip hidden layers/groups
    const hiddenLayerIndices = this.getHiddenTileLayerIndices();

    // Build set of above_player layer names from raw TMJ (by class or path)
    const tmjData = this.cache.tilemap.get(MAP_CONFIG.key)?.data;
    const abovePlayerNames = new Set<string>();
    if (tmjData) {
      this.collectAbovePlayerLayers(tmjData.layers, false, abovePlayerNames);
    }

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
        const isAbove = abovePlayerNames.has(lowerName);
        layer.setDepth(isAbove ? 200 : 0);
        layer.setCullPadding(2, 2);
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

    // Debug graphics overlay
    this.debugGfx = this.add.graphics();
    this.debugGfx.setDepth(999);

    // Camera — manual pixel-perfect follow
    // No startFollow: Phaser's preRender would overwrite our snapped scroll with fractional values
    this.cameras.main.setZoom(this.defaultZoom);
    this.cameras.main.setRoundPixels(true);
    this.cameraBounds = { x: 0, y: 0, w: map.widthInPixels, h: map.heightInPixels };
    this.cameraTargetX = this.player.x;
    this.cameraTargetY = this.player.y;
    this.snapCameraToTarget();

    // Register late-update: runs AFTER physics, tweens, and all game object updates.
    // This is Phaser's equivalent of Unity's LateUpdate — guarantees camera reads
    // final post-physics positions, preventing 1-frame-lag jitter.
    this.events.on('postupdate', this.lateUpdate, this);

    // Build pathfinding grid
    this.buildPathfindingGrid(map.widthInPixels, map.heightInPixels);

    // Click-to-move: only on pointer RELEASE (not hold), with drag threshold
    const DRAG_THRESHOLD = 8; // px — if pointer moved more than this, it was a drag, not a tap
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.movementLocked) return;
      if (this.isPinching) return;
      const dist = Phaser.Math.Distance.Between(
        pointer.downX, pointer.downY, pointer.upX, pointer.upY
      );
      if (dist > DRAG_THRESHOLD) return;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.navigateTo(worldPoint.x, worldPoint.y);
    });

    // Setup zoom controls
    this.setupZoom();
  }

  /**
   * Pixel-perfect camera positioning using PPU (Pixels Per Unit) snapping.
   *
   * PPU = camera zoom = number of screen pixels per world pixel.
   * The texel grid spacing in world units = 1/PPU.
   *
   * Phaser's rendering formula:
   *   screenX = (worldX - midPoint) * zoom + viewportWidth/2
   * where midPoint = scrollX + viewportWidth/2
   *
   * For screenX to be integer when worldX is integer:
   *   midPoint * PPU must be integer.
   * We achieve this by flooring: midPoint = floor(target * PPU) / PPU
   */
  private snapCameraToTarget() {
    const cam = this.cameras.main;
    const ppu = cam.zoom; // Pixels Per Unit = zoom
    const halfW = cam.width * 0.5;
    const halfH = cam.height * 0.5;

    // Floor to nearest texel boundary (1/PPU world units)
    // Floor is preferred over round: prevents oscillation when target hovers near a boundary
    let midX = Math.floor(this.cameraTargetX * ppu) / ppu;
    let midY = Math.floor(this.cameraTargetY * ppu) / ppu;

    // Clamp so the visible rect stays within map bounds
    const { w, h } = this.cameraBounds;
    const halfViewW = halfW / ppu;
    const halfViewH = halfH / ppu;
    const minMidX = halfViewW;
    const maxMidX = Math.max(halfViewW, w - halfViewW);
    const minMidY = halfViewH;
    const maxMidY = Math.max(halfViewH, h - halfViewH);
    midX = Phaser.Math.Clamp(midX, minMidX, maxMidX);
    midY = Phaser.Math.Clamp(midY, minMidY, maxMidY);

    // Re-snap after clamping to maintain texel alignment
    midX = Math.floor(midX * ppu) / ppu;
    midY = Math.floor(midY * ppu) / ppu;

    // Set scroll (Phaser convention: midPoint = scrollX + halfViewport)
    cam.scrollX = midX - halfW;
    cam.scrollY = midY - halfH;
  }

  /**
   * Late-update: runs after physics, tweens, and scene.update().
   * Reads final post-physics body positions and snaps the camera.
   * This prevents 1-frame lag between physics step and camera positioning.
   */
  private lateUpdate() {
    if (!this.player || !this.playerBody) return;

    // Read final physics position -> snap to integer world pixels
    // Body is offset down by playerFeetOffset; sprite origin is at the "torso" level
    this.player.x = Math.floor(this.playerBody.position.x);
    this.player.y = Math.floor(this.playerBody.position.y - this.playerFeetOffset);

    // Debug visualization
    this.drawDebug();

    // Update camera target from final player position
    if (this.cameraFollowing) {
      this.cameraTargetX = this.player.x;
      this.cameraTargetY = this.player.y;
    }

    // Final pixel-perfect camera snap (last thing before render)
    this.snapCameraToTarget();

    // Snap remote players to integer positions too
    this.otherPlayers.forEach((remote) => {
      const pos = remote.interpolator.getPosition();
      remote.container.x = Math.floor(pos.x);
      remote.container.y = Math.floor(pos.y);
    });
  }

  private drawDebug() {
    this.debugGfx.clear();
    const bx = this.playerBody.position.x;
    const by = this.playerBody.position.y;
    const bodyConfig = getBodyConfig();
    const radius = bodyConfig.radius;

    // WHITE rectangle = full character frame canvas
    const charDef = getCharacter();
    const fw = charDef.frameWidth * charDef.scale;
    const fh = charDef.frameHeight * charDef.scale;
    const frameX = this.player.x - charDef.originX * fw;
    const frameY = this.player.y - charDef.originY * fh;
    this.debugGfx.lineStyle(1, 0xffffff, 0.6);
    this.debugGfx.strokeRect(frameX, frameY, fw, fh);

    // CYAN crosshair = sprite origin point (player.x, player.y)
    this.debugGfx.lineStyle(1, 0x00ffff, 0.9);
    this.debugGfx.beginPath();
    this.debugGfx.moveTo(this.player.x - 6, this.player.y);
    this.debugGfx.lineTo(this.player.x + 6, this.player.y);
    this.debugGfx.moveTo(this.player.x, this.player.y - 6);
    this.debugGfx.lineTo(this.player.x, this.player.y + 6);
    this.debugGfx.strokePath();

    // RED circle = physics body (collision circle, radius 10)
    this.debugGfx.lineStyle(1.5, 0xff0000, 0.9);
    this.debugGfx.strokeCircle(bx, by, radius);

    // GREEN dot = foot bottom (body center + radius)
    this.debugGfx.fillStyle(0x00ff00, 1);
    this.debugGfx.fillCircle(bx, by + radius, 3);

    // BLUE cross = click position (where user clicked)
    if (this.clickMarker) {
      this.debugGfx.lineStyle(2, 0x0088ff, 1);
      const cx = this.clickMarker.x;
      const cy = this.clickMarker.y;
      this.debugGfx.strokeCircle(cx, cy, 5);
      this.debugGfx.beginPath();
      this.debugGfx.moveTo(cx - 7, cy);
      this.debugGfx.lineTo(cx + 7, cy);
      this.debugGfx.moveTo(cx, cy - 7);
      this.debugGfx.lineTo(cx, cy + 7);
      this.debugGfx.strokePath();
    }

    // MAGENTA path = remaining waypoints
    if (this.pathWaypoints.length > 0 && this.currentWaypointIndex < this.pathWaypoints.length) {
      this.debugGfx.lineStyle(1, 0xff00ff, 0.7);
      this.debugGfx.beginPath();
      this.debugGfx.moveTo(bx, by);
      for (let i = this.currentWaypointIndex; i < this.pathWaypoints.length; i++) {
        this.debugGfx.lineTo(this.pathWaypoints[i].x, this.pathWaypoints[i].y);
      }
      this.debugGfx.strokePath();

      // Orange dot = current target waypoint
      if (this.target) {
        this.debugGfx.fillStyle(0xff8800, 1);
        this.debugGfx.fillCircle(this.target.x, this.target.y, 3);
      }
    }
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
          // Quantize to nearest step to maintain clean zoom values
          this.targetZoom = Math.round(this.targetZoom / step) * step;
          this.targetZoom = Phaser.Math.Clamp(this.targetZoom, min, max);
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
        const cls = (layerData.class || '').toLowerCase();
        const layerAbove = isAbove || cls === 'above_player' || lowerName.includes('(above)');

        if (layerData.type === 'group') {
          const nowAbove = layerAbove || lowerName === 'visual_above';
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
          sprite.setDepth(layerAbove ? 200 : 0);

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

  /**
   * Recursively collects layer names (lowercased, with group path prefix) that should
   * render above the player. Detection criteria:
   * 1. Layer has class="above_player" in the TMJ
   * 2. Layer is inside a group named "visual_above" (or similar)
   * 3. Layer name contains "(above)"
   */
  private collectAbovePlayerLayers(layers: any[], parentAbove: boolean, result: Set<string>, prefix = '') {
    for (const l of layers) {
      const name = l.name || '';
      const fullName = prefix ? `${prefix}/${name}` : name;
      const lowerFull = fullName.toLowerCase();
      const cls = (l.class || '').toLowerCase();
      const isAbove = parentAbove || cls === 'above_player' || lowerFull.includes('(above)');

      if (l.type === 'group') {
        const groupAbove = isAbove || name.toLowerCase() === 'visual_above';
        this.collectAbovePlayerLayers(l.layers || [], groupAbove, result, fullName);
      } else if (l.type === 'tilelayer') {
        if (isAbove) {
          result.add(lowerFull);
        }
      }
    }
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
        // Tiled polygon vertices are relative to (obj.x, obj.y)
        const absoluteVerts = obj.polygon.map((p: { x: number; y: number }) => ({
          x: obj.x + p.x,
          y: obj.y + p.y,
        }));
        this.collisionPolys.push(absoluteVerts);
        this.createPolygonCollision(absoluteVerts, label);
      } else if (obj.width && obj.height) {
        this.collisionRects.push({ x: obj.x, y: obj.y, width: obj.width, height: obj.height });
        const cx = obj.x + obj.width / 2;
        const cy = obj.y + obj.height / 2;
        this.matter.add.rectangle(cx, cy, obj.width, obj.height, {
          isStatic: true,
          label,
        });
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

  private createPolygonCollision(absoluteVerts: { x: number; y: number }[], label: string) {
    if (absoluteVerts.length < 3) return;

    // Compute the bounding box center to pass as the initial position
    const xs = absoluteVerts.map(v => v.x);
    const ys = absoluteVerts.map(v => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bboxCx = (minX + maxX) / 2;
    const bboxCy = (minY + maxY) / 2;

    // Convert to poly-decomp format and decompose into convex parts
    const poly = absoluteVerts.map(v => [v.x, v.y] as [number, number]);

    try {
      decomp.makeCCW(poly);
      decomp.removeCollinearPoints(poly, 0.01);
      if (poly.length < 3) {
        this.createSingleConvexBody(absoluteVerts, bboxCx, bboxCy, label);
        return;
      }

      const convexParts = decomp.quickDecomp(poly);
      if (!convexParts || convexParts.length === 0) {
        this.createSingleConvexBody(absoluteVerts, bboxCx, bboxCy, label);
        return;
      }

      for (let i = 0; i < convexParts.length; i++) {
        const part = convexParts[i];
        if (part.length < 3) continue;
        const partVerts = part.map((p: number[]) => ({ x: p[0], y: p[1] }));
        const partXs = partVerts.map((v: {x: number; y: number}) => v.x);
        const partYs = partVerts.map((v: {x: number; y: number}) => v.y);
        const partCx = (Math.min(...partXs) + Math.max(...partXs)) / 2;
        const partCy = (Math.min(...partYs) + Math.max(...partYs)) / 2;
        this.createSingleConvexBody(partVerts, partCx, partCy, `${label}_p${i}`);
      }
    } catch {
      this.createSingleConvexBody(absoluteVerts, bboxCx, bboxCy, label);
    }
  }

  /**
   * Creates a single convex static body from absolute-world vertices.
   * 
   * Matter.fromVertices internally recenters the shape around its center of mass,
   * which shifts the body away from where we want it. We correct by measuring
   * the offset between where Matter placed the body's bounds and where the
   * original vertices' bounds should be.
   */
  private createSingleConvexBody(
    verts: { x: number; y: number }[],
    desiredCx: number,
    desiredCy: number,
    label: string
  ) {
    if (verts.length < 3) return;

    // Make vertices relative to the desired center (Matter expects this)
    const relVerts = verts.map(v => ({ x: v.x - desiredCx, y: v.y - desiredCy }));

    const body = this.matter.add.fromVertices(desiredCx, desiredCy, [relVerts], {
      isStatic: true,
      label,
    });

    if (body) {
      // Matter.fromVertices shifts the body to its computed center of mass.
      // Correct: compare the body's actual bounding box to the intended one.
      const bodyBounds = body.bounds;
      const actualCx = (bodyBounds.min.x + bodyBounds.max.x) / 2;
      const actualCy = (bodyBounds.min.y + bodyBounds.max.y) / 2;

      // Our intended bounding box center
      const intendedMinX = Math.min(...verts.map(v => v.x));
      const intendedMaxX = Math.max(...verts.map(v => v.x));
      const intendedMinY = Math.min(...verts.map(v => v.y));
      const intendedMaxY = Math.max(...verts.map(v => v.y));
      const intendedCx = (intendedMinX + intendedMaxX) / 2;
      const intendedCy = (intendedMinY + intendedMaxY) / 2;

      const dx = intendedCx - actualCx;
      const dy = intendedCy - actualCy;

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        this.matter.body.setPosition(body, {
          x: body.position.x + dx,
          y: body.position.y + dy,
        });
      }
    } else {
      // fromVertices failed (degenerate shape) — fallback to AABB rectangle
      const bboxW = Math.max(...verts.map(v => v.x)) - Math.min(...verts.map(v => v.x));
      const bboxH = Math.max(...verts.map(v => v.y)) - Math.min(...verts.map(v => v.y));
      if (bboxW > 1 && bboxH > 1) {
        this.matter.add.rectangle(desiredCx, desiredCy, bboxW, bboxH, {
          isStatic: true,
          label: label + '_bbox',
        });
      }
    }
  }

  private buildPathfindingGrid(mapWidth: number, mapHeight: number) {
    this.pathfinder = new AStarGrid(16);
    // Inflate obstacles by player body radius (10px) + margin
    this.pathfinder.buildGrid(mapWidth, mapHeight, this.collisionRects, this.collisionPolys, 12);
  }

  private navigateTo(worldX: number, worldY: number) {
    // Store click position for debug visualization (raw click)
    this.clickMarker = { x: worldX, y: worldY };

    // The sprite origin should land at the click point.
    // Since sprite.y = body.y - playerFeetOffset, the body must reach
    // (worldX, worldY + playerFeetOffset) for the origin to be at (worldX, worldY).
    const targetBodyX = worldX;
    const targetBodyY = worldY + this.playerFeetOffset;

    const startX = this.playerBody.position.x;
    const startY = this.playerBody.position.y;

    // Cancel any previous movement
    this.stuckFrames = 0;
    this.lastStuckPos = null;
    this.rerouteAttempts = 0;
    this.finalDestination = { x: targetBodyX, y: targetBodyY };

    const waypoints = this.pathfinder.findPath(startX, startY, targetBodyX, targetBodyY);
    if (waypoints.length >= 2) {
      this.pathWaypoints = waypoints;
      this.currentWaypointIndex = 1;
      this.target = this.pathWaypoints[this.currentWaypointIndex];
    } else {
      this.stopMovement();
    }
  }

  private reroute() {
    if (!this.finalDestination) return;

    this.rerouteAttempts++;
    if (this.rerouteAttempts > this.MAX_REROUTE_ATTEMPTS) {
      this.stopMovement();
      return;
    }

    const startX = this.playerBody.position.x;
    const startY = this.playerBody.position.y;
    const endX = this.finalDestination.x;
    const endY = this.finalDestination.y;

    const waypoints = this.pathfinder.findPath(startX, startY, endX, endY);
    if (waypoints.length >= 2) {
      this.pathWaypoints = waypoints;
      this.currentWaypointIndex = 1;
      this.target = this.pathWaypoints[this.currentWaypointIndex];
      this.stuckFrames = 0;
      this.lastStuckPos = null;
    } else {
      this.stopMovement();
    }
  }

  private stopMovement() {
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
    this.stuckFrames = 0;
    this.lastStuckPos = null;
    this.rerouteAttempts = 0;
    this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
    this.player.anims.stop();
    this.player.setFrame(getIdleFrame(this.currentDirection));
    this.emitMovement(false);
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

    // Collision body at the character's feet using a circle for smooth sliding.
    // Body config comes from admin-defined values (or fallback defaults).
    const bodyConfig = getBodyConfig(charDef.id);
    const bodyRadius = bodyConfig.radius;
    const feetOffsetY = Math.round(bodyConfig.offsetY);

    this.playerBody = this.matter.add.circle(
      x, y + feetOffsetY,
      bodyRadius,
      {
        label: 'player',
        friction: 0,
        frictionAir: 0,
        frictionStatic: 0,
        restitution: 0,
      }
    );
    this.matter.body.setInertia(this.playerBody, Infinity);
    this.playerFeetOffset = feetOffsetY;
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
        frameRate: 12,
        repeat: -1,
      });
    }
  }

  update() {
    if (!this.player || !this.playerBody) return;

    // Smooth zoom interpolation — snap to target once close enough
    const currentZoom = this.cameras.main.zoom;
    if (Math.abs(currentZoom - this.targetZoom) > 0.005) {
      const newZoom = Phaser.Math.Linear(currentZoom, this.targetZoom, MAP_CONFIG.zoom.smoothSpeed * 2);
      this.cameras.main.setZoom(newZoom);
    } else if (currentZoom !== this.targetZoom) {
      this.cameras.main.setZoom(this.targetZoom);
    }

    // Player visual position and camera are updated in lateUpdate (postupdate)
    // to guarantee they read the FINAL physics position for this frame.

    this.otherPlayers.forEach((remote) => {
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

    // Stuck detection: if the player hasn't moved significantly, reroute
    if (this.lastStuckPos) {
      const movedDist = Math.hypot(bx - this.lastStuckPos.x, by - this.lastStuckPos.y);
      if (movedDist < 0.5) {
        this.stuckFrames++;
        if (this.stuckFrames >= this.STUCK_THRESHOLD) {
          this.stuckFrames = 0;
          this.lastStuckPos = null;
          this.reroute();
          return;
        }
      } else {
        this.stuckFrames = 0;
        this.rerouteAttempts = 0;
      }
    }
    this.lastStuckPos = { x: bx, y: by };

    // Distance to current waypoint
    const dx = this.target.x - bx;
    const dy = this.target.y - by;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Check if we've arrived at the current waypoint
    const isLastWaypoint = this.currentWaypointIndex >= this.pathWaypoints.length - 1;
    const arrivalThreshold = isLastWaypoint ? this.playerSpeed * 1.5 : this.playerSpeed * 2.5;

    if (dist < arrivalThreshold) {
      if (!isLastWaypoint) {
        // Advance to next waypoint
        this.currentWaypointIndex++;
        this.target = this.pathWaypoints[this.currentWaypointIndex];
      } else {
        // Reached final destination - stop cleanly
        this.target = null;
        this.pathWaypoints = [];
        this.currentWaypointIndex = 0;
        this.finalDestination = null;
        this.rerouteAttempts = 0;
        this.matter.body.setVelocity(this.playerBody, { x: 0, y: 0 });
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
        this.emitMovement(false);
        if (this.onPositionUpdate) this.onPositionUpdate(this.player.x, this.player.y);
        return;
      }
    }

    // Calculate velocity towards current waypoint
    const tdx = this.target.x - bx;
    const tdy = this.target.y - by;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tdist < 0.1) return;

    // Decelerate when approaching the final destination
    let speed = this.playerSpeed;
    if (isLastWaypoint && tdist < this.playerSpeed * 4) {
      speed = Math.max(0.8, this.playerSpeed * (tdist / (this.playerSpeed * 4)));
    }

    const vx = (tdx / tdist) * speed;
    const vy = (tdy / tdist) * speed;
    this.matter.body.setVelocity(this.playerBody, { x: vx, y: vy });

    const dir = this.getDirection8(tdx, tdy);
    this.currentDirection = dir;
    this.player.anims.play(getAnimKey(dir), true);
    const animSpeed = this.playerSpeed / MAP_CONFIG.playerSpeed;
    this.player.anims.timeScale = animSpeed;

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
    // Send sprite position (origin point), not raw body position, for remote rendering consistency
    const spriteX = this.playerBody.position.x;
    const spriteY = this.playerBody.position.y - this.playerFeetOffset;
    this.movementSender({
      x: spriteX,
      y: spriteY,
      targetX: this.target?.x ? this.target.x : spriteX,
      targetY: this.target?.y ? this.target.y - this.playerFeetOffset : spriteY,
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
        this.player.x = Math.round(this.playerBody.position.x);
        this.player.y = Math.round(this.playerBody.position.y);
      },
      onComplete: () => {
        this.currentDirection = side === 'left' ? 'right' : 'left';
        this.player.anims.stop();
        this.player.setFrame(getIdleFrame(this.currentDirection));
      },
    });

    this.targetZoom = this.boardZoom;
    this.cameraFollowing = false;
    this.cameraTargetX = arena.x + arena.width / 2;
    this.cameraTargetY = arena.y + arena.height / 2;
  }

  public lockMovement(arenaId?: string) {
    this.movementLocked = true;
    this.target = null;
    this.pathWaypoints = [];
    this.currentWaypointIndex = 0;
    this.finalDestination = null;
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
    this.cameraFollowing = true;
  }

  public setDefaultZoom(zoom: number) {
    this.defaultZoom = zoom;
    if (!this.movementLocked) {
      this.targetZoom = zoom;
    }
  }

  public setPlayerSpeed(speed: number) {
    this.playerSpeed = speed;
  }
}
