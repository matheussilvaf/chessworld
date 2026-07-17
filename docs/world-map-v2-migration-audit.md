# Chess World v2 - Map Migration Audit Report

**Date:** 2026-07-17  
**Status:** Architecture analysis complete. New map files NOT YET on disk.

---

## 1. Current Architecture

### Framework & Versions

| Technology | Version | Role |
|---|---|---|
| Phaser | ^4.2.0 | Game engine (Arcade Physics) |
| React | ^18.3.1 | UI layer |
| Colyseus | ^0.15.28 (client) / ^0.15.0 (server) | Multiplayer rooms |
| LiveKit | ^2.20.1 | Voice chat |
| Supabase | ^2.57.4 | Auth, presence, data |
| Zustand | ^5.0.14 | State management |
| Vite | ^5.4.2 | Bundler / dev server |

### Key Files

| Purpose | File |
|---|---|
| Phaser game instance | `src/game/PhaserGame.ts` |
| Main scene | `src/game/scenes/WorldScene.ts` |
| Map config | `src/game/config/mapConfig.ts` |
| Player config | `src/game/config/playerConfig.ts` |
| Asset loading | Within `WorldScene.preload()` |
| Legacy map layout | `src/game/map/mapLayout.ts` |
| Legacy decorations | `src/game/map/decorations.ts` |
| Multiplayer client | `src/game/network/colyseusClient.ts` |
| Interpolation | `src/game/network/interpolation.ts` |
| Server room | `server/src/rooms/WorldRoom.ts` |
| Server state | `server/src/schemas/WorldState.ts` |
| Voice client | `src/game/voice/livekitVoiceClient.ts` |
| Chat hook | `src/hooks/useRealtimeChat.ts` |
| Game config constants | `src/config/game.ts` |

### How the Old Map is Loaded

1. **Preload** (`WorldScene.preload`):
   - `this.load.tilemapTiledJSON('world', '/assets/ChessWorldMap/world.tmj')`
   - 21 tileset images loaded individually from `/assets/ChessWorldMap/sprites/`
   - Player spritesheet loaded separately

2. **Create** (`WorldScene.create`):
   - `this.make.tilemap({ key: 'world' })` creates the tilemap
   - `map.addTilesetImage(name, name)` for each of the 21 tilesets (name must match Tiled)
   - Tile layers created via `map.createLayer(name, allTilesets)` - skips layers matching `skipLayers` patterns
   - GID-based objects created via `map.createFromObjects()`
   - Physics bounds = `map.widthInPixels × map.heightInPixels`

3. **Collisions** (`setupCollision`):
   - Reads object layer named `'collision'` (case-insensitive)
   - Creates invisible **rectangles** as static Arcade Physics bodies
   - Adds `physics.add.collider(player, collisionGroup)`
   - **ONLY rectangles are handled** - no polygon support

4. **Spawn** (`findSpawnPoint`):
   - Reads object layer named `'spawn'`
   - Finds object named `player_spawn` or type `spawn`
   - Fallback: center of map (`widthInPixels/2`, `heightInPixels/2`)

5. **Camera**:
   - Bounds = full map pixel dimensions
   - Follows player with lerp 0.08
   - Default zoom: 2 (board zoom: 3)

6. **Interactives** (`setupInteractives`):
   - Scans all object layers for type `chess_arena` or name containing "chess"
   - Falls back to scanning layers named "chessboard"
   - Creates interactive zones for click-to-play

### Old Map: `public/assets/ChessWorldMap/world.tmj`

- **Dimensions:** 100×80 tiles, 16×16px tile size = 1600×1280 pixels
- **Tilesets:** 21 (all embedded, no external sources)
- **Object Layers:** `Collision` (rectangles), `Spawn` (1 point), `Interactives` (4 chess_arena)
- **Tile Layers:** ~38 layers (no groups, flat structure)
- **Chess boards:** 4 (via object layers ParkChessBoard1-4 + Interactives)
- **Collision shapes:** ~40 rectangles only
- **Reference image layer:** points to desktop path (non-functional)

### Multiplayer Position Sync

- **Client → Server:** Every 50ms while moving, sends `move_to` with `{x, y, targetX, targetY, direction, isMoving}`
- **Server (`WorldRoom`):** Updates `PlayerState` schema directly; Colyseus auto-syncs to all clients
- **Default join position:** `x: 800, y: 640` (fallback in `onJoin`)
- **Remote players:** Interpolated via `RemotePlayerInterpolator`
- **No map/room ID** is sent with position — all players share one WorldRoom per region

### Chat & Voice Relationship with Scene

- **Text chat:** Handled entirely via Colyseus room messages (`'chat'` event). UI is a React overlay (`PublicChat.tsx`). No coupling to scene coordinates or map.
- **Voice chat:** LiveKit room named `voice_world_{region}`. Colyseus notified via `voice_joined`/`voice_left`/`voice_muted_changed`. VoiceParticipantState tracked in WorldState schema. No coupling to map geometry.

### Hardcoded References to Old Map

| File | Reference | Value |
|---|---|---|
| `src/config/game.ts` | `WORLD_WIDTH` / `WORLD_HEIGHT` | 1600 / 1280 |
| `src/game/map/mapLayout.ts` | `MAP_WIDTH` / `MAP_HEIGHT` | 2000 / 1500 (legacy) |
| `src/game/map/mapLayout.ts` | `SPAWN_X` / `SPAWN_Y` | 1000 / 750 (legacy) |
| `src/game/map/mapLayout.ts` | `ARENAS[]` | 10 arenas with absolute px coords |
| `src/game/map/mapLayout.ts` | `HOUSES[]` | 8 houses with absolute px coords |
| `src/game/scenes/WorldScene.ts` | `getPlayerPosition()` fallback | 800, 640 |
| `server/src/rooms/WorldRoom.ts` | default join position | 800, 640 |
| `src/game/config/mapConfig.ts` | `path`, `basePath`, `tileSize` | `/assets/ChessWorldMap/world.tmj`, 16 |

---

## 2. New Map Files - Status

### CRITICAL FINDING: Files Not Present

The following files referenced in the task do **not exist** on disk:

- `public/assets/worldv2/newworld.tmj` (main world)
- `public/assets/worldv2/main_village_template.tmj` (village template)
- `public/assets/worldv2/sprites/tilesets/*` (tileset PNGs)

The entire `public/assets/worldv2/` directory is absent. These files appear in the project manifest but have not been uploaded or created.

**Action required:** Upload/place the new TMJ files and their associated tileset images before proceeding with validation tasks 2-6.

---

## 3. Physics System - Polygon Collision Support

### Current State

The current `setupCollision` method in `WorldScene.ts` (line 256-274) **only supports rectangles**:

```typescript
collisionLayer.objects.forEach(obj => {
  if (obj.x !== undefined && obj.y !== undefined && obj.width && obj.height) {
    const rect = this.add.rectangle(
      obj.x + obj.width / 2, obj.y + obj.height / 2,
      obj.width, obj.height
    );
    this.physics.add.existing(rect, true);
    this.collisionGroup.add(rect);
  }
});
```

### What Needs to Change

The new map uses **polygon-based collisions** for irregular structures. Phaser 4 Arcade Physics does **not natively support polygon bodies**. Options:

1. **Decompose polygons into convex parts** using a library like `poly-decomp` and create multiple Arcade bodies per polygon. Simple but imprecise for complex shapes.

2. **Switch to Matter.js physics** (Phaser's alternative physics engine) which natively supports polygon bodies via `this.matter.add.fromVertices()`. This is the cleanest solution but requires:
   - Changing `physics: { default: 'arcade' }` → `physics: { default: 'matter' }` in the Phaser config
   - Rewriting player body creation
   - Rewriting all collider setup
   - Testing performance with many polygon bodies

3. **Hybrid approach:** Keep Arcade for player movement but create invisible Matter bodies for polygon collisions and check overlaps manually. More complex but lower blast radius.

4. **Approximate with rectangles:** For simple polygons, compute bounding box. NOT recommended per requirements ("do not simplify polygons").

### Recommendation

**Option 2 (Matter.js)** is the cleanest path. Phaser 4's Matter integration handles Tiled polygon objects well. The migration effort is significant but contained to:
- `PhaserGame.ts` (physics config)
- `WorldScene.ts` (player body, collision setup, movement)
- `playerConfig.ts` (body size/offset)

---

## 4. Files That Will Need Modification During Migration

| File | Change Required |
|---|---|
| `src/game/config/mapConfig.ts` | New path, basePath, tileSize (32), new skipLayers |
| `src/game/scenes/WorldScene.ts` | New tileset list, polygon collisions, new interactive layer names, spawn logic |
| `src/game/PhaserGame.ts` | Physics engine config (if switching to Matter) |
| `src/game/config/playerConfig.ts` | Body size/offset for new tile size |
| `src/config/game.ts` | `WORLD_WIDTH`/`WORLD_HEIGHT` constants |
| `src/game/map/mapLayout.ts` | Remove or replace — legacy hardcoded positions |
| `src/game/map/decorations.ts` | Remove or replace — procedural map no longer used |
| `server/src/rooms/WorldRoom.ts` | Default spawn coordinates |
| `src/components/game/BoardModal.tsx` | Arena ID format if changed |
| `src/hooks/useRealtimeBoards.ts` | Board registration if IDs change |

---

## 5. Regression Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Physics engine swap breaks player movement | HIGH | Test extensively; keep old scene as fallback |
| Tileset name mismatch breaks rendering | MEDIUM | Script validates names match TMJ exactly |
| Spawn point mismatch causes players to spawn off-map | MEDIUM | Validate spawn exists and is within bounds |
| Board/arena IDs change, break existing challenges | HIGH | Map old IDs to new or keep compatible names |
| Different tile size (16→32) affects body offsets | MEDIUM | Adjust all body size/offset values |
| Map pixel dimensions change affects server defaults | LOW | Update WorldRoom fallback coords |
| Chat/voice unaffected (no coupling to map geometry) | NONE | - |

---

## 6. Recommended Implementation Order

1. **Upload new map files** and tileset PNGs to `public/assets/worldv2/`
2. **Run validation script** (`npm run validate:world-maps`) — fix any image/structure issues
3. **Create a new MapConfig** for v2 (separate from old config, don't replace yet)
4. **Create a parallel scene** (`WorldSceneV2`) that loads the new map
5. **Implement polygon collision support** (Matter.js or poly-decomp)
6. **Wire up interactives** (chess tables, houses, portals) from new object layers
7. **Add scene switching** capability (feature flag or config)
8. **Test multiplayer** with new coordinates and spawn points
9. **Update server defaults** once new map is confirmed working
10. **Remove old map** only after new version is stable in production

---

## 7. Strategy to Preserve Chat, Voice & Multiplayer

- **Chat:** No changes needed. Chat is message-based via Colyseus room, completely decoupled from map geometry.
- **Voice:** No changes needed. LiveKit room is named by region, not by map.
- **Multiplayer position sync:** Works with any coordinates. The `move_to` message sends absolute x/y. As long as all players load the same map, positions will be consistent.
- **Board registration:** The `register_boards` message already dynamically registers arena metadata from the Tiled map. No hardcoded server-side board positions.
- **Migration path:** Both scenes can coexist. Route all clients to either old or new scene. Once new scene is validated, deprecate old.

---

## 8. Strategy to Remove Old Map

1. Keep old map **fully functional** during development of new scene
2. Add a config switch (`MAP_VERSION: 'v1' | 'v2'`) to select which scene loads
3. Deploy v2 as opt-in (feature flag or URL param) for testing
4. Once v2 is confirmed stable with all features working:
   - Remove `public/assets/ChessWorldMap/` directory
   - Remove legacy files: `mapLayout.ts`, `decorations.ts`
   - Update `mapConfig.ts` to point exclusively to new paths
   - Clean up any `v1`/`v2` branching code

---

## 9. Validation Script Results

```
npm run validate:world-maps

STATUS: FAILED
ERRORS: 2
  - [main_world] File not found: public/assets/worldv2/newworld.tmj
  - [village_template] File not found: public/assets/worldv2/main_village_template.tmj
```

**Reason:** The new map TMJ files and their associated tileset images have not been placed on disk yet. The validation script is ready and will perform full structural validation once the files are uploaded.

---

## 10. Next Steps Required

1. **Upload the new TMJ files** to `public/assets/worldv2/`:
   - `newworld.tmj` (main world map)
   - `main_village_template.tmj` (village template)
2. **Upload all tileset PNGs** to `public/assets/worldv2/sprites/tilesets/`
3. **Re-run** `npm run validate:world-maps` to get full structural validation
4. Once validation passes, proceed with implementation per the order above
