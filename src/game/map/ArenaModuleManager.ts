import { ALL_TILESETS, findTilesetForGidInMap, type TilesetEntry } from '../config/worldAssets';

export interface ModuleConfig {
  instanceId: string;
  moduleType: string;
  order: number;
}

export interface TableMapping {
  runtimeTableId: string;
  tableNumber: number;
  moduleInstanceId: string;
  localSlotId: string;
}

interface ModuleInstance {
  instanceId: string;
  offsetX: number;
  offsetY: number;
  sprites: Phaser.GameObjects.Sprite[];
  bodies: MatterJS.BodyType[];
  tableAnchors: Map<string, TableAnchorSet>;
}

export interface TableAnchorSet {
  tableId: string;
  playerTop: { x: number; y: number; direction: string };
  playerBottom: { x: number; y: number; direction: string };
  spectatorLeft01: { x: number; y: number; direction: string };
  spectatorLeft02: { x: number; y: number; direction: string };
  spectatorRight01: { x: number; y: number; direction: string };
  spectatorRight02: { x: number; y: number; direction: string };
  exitTop: { x: number; y: number; direction: string };
  exitBottom: { x: number; y: number; direction: string };
  exitLeft: { x: number; y: number; direction: string };
  exitRight: { x: number; y: number; direction: string };
}

const MODULE_PATHS: Record<string, string> = {
  double: 'tournament_table_module_double',
  single: 'tournament_table_module_single',
  end: 'tournament_table_module_end',
};

const MODULE_CONNECTORS: Record<string, { south: string; north?: string }> = {
  double: { south: 'double_module_south_connector', north: 'double_module_north_connector' },
  single: { south: 'single_module_south_connector', north: 'single_module_north_connector' },
  end: { south: 'end_module_south_connector' },
};

export class ArenaModuleManager {
  private scene: Phaser.Scene;
  private modules: ModuleInstance[] = [];
  private loaded = false;
  private doorBlockerBody: MatterJS.BodyType | null = null;
  private doorBlockerRect: { x: number; y: number; w: number; h: number } | null = null;
  private doorClosedSprite: Phaser.GameObjects.Sprite | null = null;
  private doorOpenSprite: Phaser.GameObjects.Sprite | null = null;
  private totalBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  public initDoorBlocker(tmjData: any) {
    const dynamicCollisions = this.findObjectLayer(tmjData.layers, 'dynamic_collisions');
    if (!dynamicCollisions) return;

    for (const obj of dynamicCollisions) {
      if (obj.name === 'north_extension_door_blocker') {
        const cx = obj.x + obj.width / 2;
        const cy = obj.y + obj.height / 2;
        this.doorBlockerRect = { x: cx, y: cy, w: obj.width, h: obj.height };
        this.doorBlockerBody = this.scene.matter.add.rectangle(cx, cy, obj.width, obj.height, {
          isStatic: true,
          label: 'north_extension_door_blocker',
        });
        break;
      }
    }

    // Render door visuals from dynamic_visuals layer
    const dynamicVisuals = this.findObjectLayer(tmjData.layers, 'dynamic_visuals');
    if (!dynamicVisuals) return;

    const tmjTilesets = tmjData.tilesets || [];
    for (const obj of dynamicVisuals) {
      if (!obj.gid) continue;
      const props = this.getObjProps(obj);
      const tsDef = findTilesetForGidInMap(obj.gid & 0x0FFFFFFF, tmjTilesets);
      if (!tsDef || !tsDef.isSingleImage) continue;

      const sprite = this.scene.add.sprite(obj.x, obj.y, tsDef.textureKey);
      sprite.setOrigin(0, 1);
      sprite.setDisplaySize(obj.width || 32, obj.height || 32);
      sprite.setDepth(200); // above characters

      if (props.visualState === 'closed') {
        this.doorClosedSprite = sprite;
        sprite.setVisible(true);
      } else if (props.visualState === 'open') {
        this.doorOpenSprite = sprite;
        sprite.setVisible(false);
      }
    }
  }

  public setDoorOpen(open: boolean) {
    if (this.doorClosedSprite) this.doorClosedSprite.setVisible(!open);
    if (this.doorOpenSprite) this.doorOpenSprite.setVisible(open);

    if (open && this.doorBlockerBody) {
      this.scene.matter.world.remove(this.doorBlockerBody);
      this.doorBlockerBody = null;
    } else if (!open && !this.doorBlockerBody && this.doorBlockerRect) {
      // Re-create blocker when door closes
      const { x, y, w, h } = this.doorBlockerRect;
      this.doorBlockerBody = this.scene.matter.add.rectangle(x, y, w, h, {
        isStatic: true,
        label: 'north_extension_door_blocker',
      });
    }
  }

  public async loadModules(
    modules: ModuleConfig[],
    tables: TableMapping[],
    receptionTmjKey: string,
  ): Promise<{ minY: number; maxY: number; width: number }> {
    if (this.loaded) return this.getBounds();
    if (modules.length === 0) return { minY: 0, maxY: 0, width: 0 };

    const receptionTmj = this.scene.cache.tilemap.get(receptionTmjKey)?.data;
    if (!receptionTmj) return { minY: 0, maxY: 0, width: 0 };

    // Find reception_north_connector
    const receptionConnector = this.findConnector(receptionTmj.layers, 'reception_north_connector');
    if (!receptionConnector) {
      console.warn('[ArenaModuleManager] reception_north_connector not found');
      return { minY: 0, maxY: 0, width: 0 };
    }

    const recWidth = receptionTmj.width * (receptionTmj.tilewidth || 32);
    const recHeight = receptionTmj.height * (receptionTmj.tileheight || 32);
    this.totalBounds = { minX: 0, minY: 0, maxX: recWidth, maxY: recHeight };

    const sorted = [...modules].sort((a, b) => a.order - b.order);
    let previousNorth = { x: receptionConnector.x, y: receptionConnector.y };

    for (const mod of sorted) {
      const mapKey = MODULE_PATHS[mod.moduleType] || mod.moduleType;
      const tmjData = this.scene.cache.tilemap.get(mapKey)?.data;
      if (!tmjData) {
        console.warn(`[ArenaModuleManager] No TMJ data for ${mapKey}`);
        continue;
      }

      const connectors = MODULE_CONNECTORS[mod.moduleType];
      if (!connectors) continue;

      const southConn = this.findConnector(tmjData.layers, connectors.south);
      if (!southConn) {
        console.warn(`[ArenaModuleManager] ${connectors.south} not found`);
        continue;
      }

      // Offset: align south connector of module with previous north connector
      const offsetX = previousNorth.x - southConn.x;
      const offsetY = previousNorth.y - southConn.y;

      const modInstance = this.renderModule(mod.instanceId, tmjData, offsetX, offsetY);

      // Register table anchors
      const moduleTables = tables.filter(t => t.moduleInstanceId === mod.instanceId);
      this.extractTableAnchors(tmjData, offsetX, offsetY, mod.instanceId, moduleTables, modInstance);

      this.modules.push(modInstance);

      // Update bounds
      const modWidth = tmjData.width * (tmjData.tilewidth || 32);
      const modHeight = tmjData.height * (tmjData.tileheight || 32);
      this.totalBounds.minY = Math.min(this.totalBounds.minY, offsetY);
      this.totalBounds.maxX = Math.max(this.totalBounds.maxX, offsetX + modWidth);

      // Find north connector for next module
      if (connectors.north) {
        const northConn = this.findConnector(tmjData.layers, connectors.north);
        if (northConn) {
          previousNorth = { x: northConn.x + offsetX, y: northConn.y + offsetY };
        }
      }
    }

    this.loaded = true;
    console.log(`[ArenaModuleManager] Loaded ${this.modules.length} modules, bounds: minY=${this.totalBounds.minY}`);
    return this.getBounds();
  }

  private renderModule(instanceId: string, tmjData: any, offsetX: number, offsetY: number): ModuleInstance {
    const modInstance: ModuleInstance = {
      instanceId,
      offsetX,
      offsetY,
      sprites: [],
      bodies: [],
      tableAnchors: new Map(),
    };

    const tileWidth = tmjData.tilewidth || 32;
    const tileHeight = tmjData.tileheight || 32;
    const mapCols = tmjData.width;

    // Normalize tilesets (external refs use 'source' instead of 'name')
    const normalizedTilesets = (tmjData.tilesets || []).map((ts: any) => ({
      firstgid: ts.firstgid,
      name: ts.name || (ts.source ? ts.source.replace(/\.(tsx|tsj|json)$/, '') : ''),
    }));

    // 1. Render tile layers
    this.renderTileLayers(tmjData.layers, normalizedTilesets, tileWidth, tileHeight, mapCols, offsetX, offsetY, modInstance);

    // 2. Render GID objects (chess tables, decorations)
    this.renderGidObjects(tmjData.layers, normalizedTilesets, offsetX, offsetY, modInstance);

    // 3. Add collisions
    this.addCollisions(tmjData.layers, offsetX, offsetY, modInstance);

    return modInstance;
  }

  private renderTileLayers(
    layers: any[],
    tilesets: { firstgid: number; name: string }[],
    tileWidth: number,
    tileHeight: number,
    mapCols: number,
    offsetX: number,
    offsetY: number,
    modInstance: ModuleInstance,
  ) {
    for (const l of layers) {
      if (l.type === 'group') {
        this.renderTileLayers(l.layers || [], tilesets, tileWidth, tileHeight, mapCols, offsetX, offsetY, modInstance);
      } else if (l.type === 'tilelayer' && l.data && l.visible !== false) {
        const name = (l.name || '').toLowerCase();
        for (let i = 0; i < l.data.length; i++) {
          const rawGid = l.data[i];
          if (rawGid === 0) continue;

          const gid = rawGid & 0x0FFFFFFF;
          const col = i % mapCols;
          const row = Math.floor(i / mapCols);
          const x = col * tileWidth + offsetX;
          const y = row * tileHeight + offsetY;

          const tsInfo = findTilesetForGidInMap(gid, tilesets);
          if (!tsInfo) continue;

          const textureKey = tsInfo.textureKey;
          if (!this.scene.textures.exists(textureKey)) continue;

          if (tsInfo.isSingleImage) {
            const sprite = this.scene.add.sprite(x + tileWidth / 2, y + tileHeight / 2, textureKey);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDisplaySize(tileWidth, tileHeight);
            sprite.setDepth(name.includes('above') ? 200 : 0);
            modInstance.sprites.push(sprite);
          } else {
            const localId = gid - tsInfo.firstgid;
            const texSource = this.scene.textures.get(textureKey).source[0];
            const tsWidth = texSource?.width || 256;
            const columns = Math.floor(tsWidth / tileWidth);
            if (columns === 0) continue;

            const frameX = (localId % columns) * tileWidth;
            const frameY = Math.floor(localId / columns) * tileHeight;

            const frameName = `${textureKey}_tile_${localId}`;
            const tex = this.scene.textures.get(textureKey);
            if (!tex.has(frameName)) {
              tex.add(frameName, 0, frameX, frameY, tileWidth, tileHeight);
            }

            const sprite = this.scene.add.sprite(x + tileWidth / 2, y + tileHeight / 2, textureKey, frameName);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(name.includes('above') ? 200 : 0);
            modInstance.sprites.push(sprite);
          }
        }
      }
    }
  }

  private renderGidObjects(
    layers: any[],
    tilesets: { firstgid: number; name: string }[],
    offsetX: number,
    offsetY: number,
    modInstance: ModuleInstance,
  ) {
    for (const l of layers) {
      if (l.type === 'group') {
        this.renderGidObjects(l.layers || [], tilesets, offsetX, offsetY, modInstance);
      } else if (l.type === 'objectgroup') {
        const name = (l.name || '').toLowerCase();
        // Skip logical layers
        if (name === 'collisions' || name === 'module_connectors' || name.includes('character_anchors') || name === 'spawns' || name === 'ui anchors') continue;

        for (const obj of l.objects || []) {
          if (!obj.gid || obj.visible === false) continue;

          const rawGid = obj.gid;
          const gid = rawGid & 0x0FFFFFFF;
          const tsInfo = findTilesetForGidInMap(gid, tilesets);
          if (!tsInfo) continue;

          const textureKey = tsInfo.textureKey;
          if (!this.scene.textures.exists(textureKey)) continue;

          // Tiled places objects with bottom-left origin
          const sprite = this.scene.add.sprite(obj.x + offsetX, obj.y + offsetY, textureKey);
          sprite.setOrigin(0, 1);
          sprite.setDisplaySize(obj.width || 32, obj.height || 32);

          // Determine depth
          const props = this.getObjProps(obj);
          const isAbove = name.includes('above') || props.renderLayer === 'above_characters';
          sprite.setDepth(isAbove ? 200 : 10);

          // Handle flipping
          const FLIPPED_H = 0x80000000;
          const FLIPPED_V = 0x40000000;
          if (rawGid & FLIPPED_H) sprite.setFlipX(true);
          if (rawGid & FLIPPED_V) sprite.setFlipY(true);

          modInstance.sprites.push(sprite);
        }
      }
    }
  }

  private addCollisions(layers: any[], offsetX: number, offsetY: number, modInstance: ModuleInstance) {
    const collisionLayer = this.findObjectLayer(layers, 'collisions');
    if (!collisionLayer) return;

    for (const obj of collisionLayer) {
      if (obj.polygon) {
        const verts = obj.polygon.map((p: { x: number; y: number }) => ({
          x: obj.x + p.x + offsetX,
          y: obj.y + p.y + offsetY,
        }));
        const xs = verts.map((v: any) => v.x);
        const ys = verts.map((v: any) => v.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const centered = verts.map((v: any) => ({ x: v.x - cx, y: v.y - cy }));
        try {
          const body = this.scene.matter.add.fromVertices(cx, cy, [centered], { isStatic: true });
          if (body) modInstance.bodies.push(body);
        } catch { /* skip invalid polygon */ }
      } else if (obj.width && obj.height) {
        const cx = obj.x + obj.width / 2 + offsetX;
        const cy = obj.y + obj.height / 2 + offsetY;
        const body = this.scene.matter.add.rectangle(cx, cy, obj.width, obj.height, { isStatic: true });
        if (body) modInstance.bodies.push(body);
      }
    }
  }

  private extractTableAnchors(
    tmjData: any,
    offsetX: number,
    offsetY: number,
    moduleInstanceId: string,
    tableMappings: TableMapping[],
    modInstance: ModuleInstance,
  ) {
    const anchorsLayer = this.findObjectLayer(tmjData.layers, 'character_anchors');
    if (!anchorsLayer) return;

    // Group anchors by tableId
    const byTable = new Map<string, any[]>();
    for (const obj of anchorsLayer) {
      const props = this.getObjProps(obj);
      const tableId = props.tableId as string;
      if (!tableId) continue;
      if (!byTable.has(tableId)) byTable.set(tableId, []);
      byTable.get(tableId)!.push({ ...obj, _props: props, x: obj.x + offsetX, y: obj.y + offsetY });
    }

    for (const [slotId, anchors] of byTable) {
      const mapping = tableMappings.find(t => t.localSlotId === slotId);
      const runtimeId = mapping ? mapping.runtimeTableId : `${moduleInstanceId}_${slotId}`;

      const find = (anchorType: string, role: string, position?: string, side?: string, seatIndex?: string) => {
        const match = anchors.find((a: any) => {
          const p = a._props;
          return p.anchorType === anchorType &&
            p.role === role &&
            (position === undefined || p.position === position) &&
            (side === undefined || p.side === side) &&
            (seatIndex === undefined || p.seatIndex === seatIndex);
        });
        return match ? { x: match.x, y: match.y, direction: (match._props.direction as string) || 'down' } : { x: 0, y: 0, direction: 'down' };
      };

      const anchorSet: TableAnchorSet = {
        tableId: runtimeId,
        playerTop: find('chess_seat', 'player', 'top'),
        playerBottom: find('chess_seat', 'player', 'bottom'),
        spectatorLeft01: find('chess_seat', 'spectator', undefined, 'left', '1'),
        spectatorLeft02: find('chess_seat', 'spectator', undefined, 'left', '2'),
        spectatorRight01: find('chess_seat', 'spectator', undefined, 'right', '1'),
        spectatorRight02: find('chess_seat', 'spectator', undefined, 'right', '2'),
        exitTop: find('chess_seat_exit', 'player', undefined, 'top'),
        exitBottom: find('chess_seat_exit', 'player', undefined, 'bottom'),
        exitLeft: find('chess_seat_exit', 'spectator', undefined, 'left'),
        exitRight: find('chess_seat_exit', 'spectator', undefined, 'right'),
      };

      modInstance.tableAnchors.set(runtimeId, anchorSet);
    }
  }

  public getTableAnchors(): Map<string, TableAnchorSet> {
    const all = new Map<string, TableAnchorSet>();
    for (const mod of this.modules) {
      for (const [id, anchors] of mod.tableAnchors) {
        all.set(id, anchors);
      }
    }
    return all;
  }

  public removeAll() {
    for (const mod of this.modules) {
      for (const sprite of mod.sprites) sprite.destroy();
      for (const body of mod.bodies) this.scene.matter.world.remove(body);
    }
    this.modules = [];
    this.loaded = false;
  }

  public getBounds(): { minY: number; maxY: number; width: number } {
    return {
      minY: this.totalBounds.minY,
      maxY: this.totalBounds.maxY,
      width: this.totalBounds.maxX,
    };
  }

  // --- Helpers ---

  private findConnector(layers: any[], name: string): { x: number; y: number } | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findConnector(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup') {
        for (const obj of l.objects || []) {
          if (obj.name === name) return { x: obj.x, y: obj.y };
        }
      }
    }
    return null;
  }

  private findObjectLayer(layers: any[], name: string): any[] | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findObjectLayer(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup' && l.name?.toLowerCase() === name.toLowerCase()) {
        return l.objects || [];
      }
    }
    return null;
  }

  private getObjProps(obj: any): Record<string, any> {
    const result: Record<string, any> = {};
    for (const p of obj.properties || []) {
      result[p.name] = p.value;
    }
    return result;
  }
}
