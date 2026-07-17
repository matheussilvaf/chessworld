#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const MAIN_WORLD_PATH = join(projectRoot, 'public/assets/worldv2/newworld.tmj');
const VILLAGE_TEMPLATE_PATH = join(projectRoot, 'public/assets/worldv2/main_village_template.tmj');

const errors = [];
const warnings = [];
const info = [];

function error(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }
function log(msg) { info.push(msg); }

function loadJSON(filePath, label) {
  if (!existsSync(filePath)) {
    error(`[${label}] File not found: ${filePath}`);
    return null;
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    log(`[${label}] Valid JSON (${(raw.length / 1024).toFixed(1)} KB)`);
    return data;
  } catch (e) {
    error(`[${label}] Invalid JSON: ${e.message}`);
    return null;
  }
}

function checkExternalSources(tilesets, label) {
  for (const ts of tilesets) {
    if (ts.source) {
      error(`[${label}] Tileset "${ts.name || '(unnamed)'}" uses external source: ${ts.source}`);
    }
  }
}

function checkTilesetImages(tilesets, tmjDir, label) {
  const missing = [];
  const found = [];
  for (const ts of tilesets) {
    if (!ts.image) continue;
    const imgPath = resolve(tmjDir, ts.image);
    if (existsSync(imgPath)) {
      found.push(ts.image);
    } else {
      missing.push(ts.image);
      error(`[${label}] Missing tileset image: ${ts.image} (expected at ${imgPath})`);
    }
  }
  log(`[${label}] Tileset images: ${found.length} found, ${missing.length} missing`);
  return { found, missing };
}

function getLayerNames(layers, prefix = '') {
  const names = [];
  for (const layer of layers) {
    const fullName = prefix ? `${prefix}/${layer.name}` : layer.name;
    names.push({ name: layer.name, fullName, type: layer.type, id: layer.id });
    if (layer.layers) {
      names.push(...getLayerNames(layer.layers, fullName));
    }
  }
  return names;
}

function getObjectLayers(layers) {
  const result = [];
  for (const layer of layers) {
    if (layer.type === 'objectgroup') {
      result.push(layer);
    }
    if (layer.layers) {
      result.push(...getObjectLayers(layer.layers));
    }
  }
  return result;
}

function getAllObjects(layers) {
  const objects = [];
  const objectLayers = getObjectLayers(layers);
  for (const layer of objectLayers) {
    if (layer.objects) {
      for (const obj of layer.objects) {
        objects.push({ ...obj, _layerName: layer.name });
      }
    }
  }
  return objects;
}

function countObjectTypes(objects) {
  let rectangles = 0;
  let points = 0;
  let polygons = 0;
  let polylines = 0;
  let ellipses = 0;
  let tiles = 0;

  for (const obj of objects) {
    if (obj.polygon) polygons++;
    else if (obj.polyline) polylines++;
    else if (obj.ellipse) ellipses++;
    else if (obj.point) points++;
    else if (obj.gid) tiles++;
    else if (obj.width > 0 && obj.height > 0) rectangles++;
    else if (obj.width === 0 && obj.height === 0) points++;
    else rectangles++;
  }

  return { rectangles, points, polygons, polylines, ellipses, tiles };
}

function checkOutOfBounds(objects, mapWidthPx, mapHeightPx, label) {
  let outCount = 0;
  for (const obj of objects) {
    const x = obj.x || 0;
    const y = obj.y || 0;
    const w = obj.width || 0;
    const h = obj.height || 0;

    if (x < 0 || y < 0 || (x + w) > mapWidthPx + 1 || (y + h) > mapHeightPx + 1) {
      if (obj.polygon || obj.polyline) continue;
      if (x < -10 || y < -10 || (x + w) > mapWidthPx + 50 || (y + h) > mapHeightPx + 50) {
        warn(`[${label}] Object "${obj.name || obj.id}" in layer "${obj._layerName}" is significantly outside bounds: (${x}, ${y}) size ${w}x${h}`);
        outCount++;
      }
    }
  }
  return outCount;
}

function getProperty(obj, propName) {
  if (!obj.properties) return undefined;
  const prop = obj.properties.find(p => p.name === propName);
  return prop ? prop.value : undefined;
}

function getMapProperty(mapData, propName) {
  if (!mapData.properties) return undefined;
  const prop = mapData.properties.find(p => p.name === propName);
  return prop ? prop.value : undefined;
}

function validateMainWorld(data) {
  const label = 'main_world';
  const mapWidthPx = data.width * data.tilewidth;
  const mapHeightPx = data.height * data.tileheight;

  log(`[${label}] Dimensions: ${data.width}x${data.height} tiles, ${data.tilewidth}x${data.tileheight}px tile size`);
  log(`[${label}] Pixel size: ${mapWidthPx}x${mapHeightPx}`);

  if (data.properties) {
    log(`[${label}] Map properties:`);
    for (const p of data.properties) {
      log(`  - ${p.name}: ${p.value} (${p.type})`);
    }
  } else {
    warn(`[${label}] No custom map properties defined`);
  }

  // Check tilesets
  checkExternalSources(data.tilesets || [], label);
  log(`[${label}] Tilesets declared: ${(data.tilesets || []).length}`);
  for (const ts of data.tilesets || []) {
    log(`  - ${ts.name} (firstgid: ${ts.firstgid}, image: ${ts.image || 'N/A'})`);
  }

  const tmjDir = dirname(MAIN_WORLD_PATH);
  checkTilesetImages(data.tilesets || [], tmjDir, label);

  // Layers
  const allLayers = getLayerNames(data.layers || []);
  log(`[${label}] Total layers: ${allLayers.length}`);

  const expectedObjectLayers = [
    'world_zones',
    'character_anchors',
    'camera_anchors',
    'ui_anchors',
    'portal_interactions',
    'village_interactions',
    'house_interactions',
    'spawns',
    'building_interactions',
    'collisions',
    'chess_tables_interactions',
  ];

  log(`[${label}] --- Checking required logical layers ---`);
  for (const layerName of expectedObjectLayers) {
    const found = allLayers.find(l => l.name.toLowerCase() === layerName.toLowerCase());
    if (found) {
      log(`  [OK] ${layerName} (type: ${found.type})`);
    } else {
      warn(`  [MISSING] ${layerName}`);
    }
  }

  // Objects analysis
  const allObjects = getAllObjects(data.layers || []);
  const types = countObjectTypes(allObjects);
  log(`[${label}] Object counts: rectangles=${types.rectangles}, polygons=${types.polygons}, points=${types.points}, polylines=${types.polylines}, ellipses=${types.ellipses}, tiles=${types.tiles}`);

  const outOfBounds = checkOutOfBounds(allObjects, mapWidthPx, mapHeightPx, label);
  if (outOfBounds > 0) {
    warn(`[${label}] ${outOfBounds} objects significantly outside map bounds`);
  }

  // Count chess tables/boards
  const chessObjects = allObjects.filter(o => {
    const type = (o.type || '').toLowerCase();
    const name = (o.name || '').toLowerCase();
    return type.includes('chess') || type.includes('board') || name.includes('chess_table') || name.includes('chessboard');
  });
  log(`[${label}] Chess table/board objects found: ${chessObjects.length}`);

  // Count houses
  const houseObjects = allObjects.filter(o => {
    const type = (o.type || '').toLowerCase();
    const name = (o.name || '').toLowerCase();
    return type.includes('house') || name.includes('house');
  });
  log(`[${label}] House objects found: ${houseObjects.length}`);

  // Player positions per board
  const playerPositions = allObjects.filter(o => {
    const name = (o.name || '').toLowerCase();
    const type = (o.type || '').toLowerCase();
    return name.includes('player_seat') || name.includes('player_position') || type.includes('player_seat');
  });
  log(`[${label}] Player seat positions: ${playerPositions.length}`);

  // Spectator positions
  const spectatorPositions = allObjects.filter(o => {
    const name = (o.name || '').toLowerCase();
    const type = (o.type || '').toLowerCase();
    return name.includes('spectator') || type.includes('spectator');
  });
  log(`[${label}] Spectator positions: ${spectatorPositions.length}`);

  // Camera anchors
  const cameraAnchors = allObjects.filter(o => o._layerName?.toLowerCase() === 'camera_anchors');
  log(`[${label}] Camera anchors: ${cameraAnchors.length}`);

  // Spawn points
  const spawns = allObjects.filter(o => o._layerName?.toLowerCase() === 'spawns');
  log(`[${label}] Spawn objects: ${spawns.length}`);

  // Collision shapes
  const collisions = allObjects.filter(o => o._layerName?.toLowerCase() === 'collisions');
  const collisionTypes = countObjectTypes(collisions);
  log(`[${label}] Collision objects: total=${collisions.length}, rectangles=${collisionTypes.rectangles}, polygons=${collisionTypes.polygons}`);

  // Layer groups and tile layers
  const groups = allLayers.filter(l => l.type === 'group');
  const tileLayers = allLayers.filter(l => l.type === 'tilelayer');
  const objectGroups = allLayers.filter(l => l.type === 'objectgroup');
  log(`[${label}] Layer breakdown: groups=${groups.length}, tile_layers=${tileLayers.length}, object_layers=${objectGroups.length}`);

  // List all layer names
  log(`[${label}] --- All layers ---`);
  for (const l of allLayers) {
    log(`  ${l.type.padEnd(12)} ${l.fullName}`);
  }

  // Duplicate layer names (may be intentional in groups)
  const nameCount = {};
  for (const l of allLayers) {
    nameCount[l.name] = (nameCount[l.name] || 0) + 1;
  }
  const duplicates = Object.entries(nameCount).filter(([, c]) => c > 1);
  if (duplicates.length > 0) {
    log(`[${label}] Duplicate layer names (may be intentional within groups):`);
    for (const [name, count] of duplicates) {
      log(`  - "${name}" appears ${count} times`);
    }
  }

  // Custom properties on objects
  const propsUsed = new Set();
  for (const obj of allObjects) {
    if (obj.properties) {
      for (const p of obj.properties) {
        propsUsed.add(p.name);
      }
    }
  }
  if (propsUsed.size > 0) {
    log(`[${label}] Custom properties used on objects: ${[...propsUsed].sort().join(', ')}`);
  }

  // Validation: expected 14 boards
  if (chessObjects.length === 14) {
    log(`[${label}] [PASS] 14 chess boards found`);
  } else if (chessObjects.length > 0) {
    warn(`[${label}] Expected 14 chess boards, found ${chessObjects.length}`);
  }

  // Validation: expected 36 houses
  if (houseObjects.length === 36) {
    log(`[${label}] [PASS] 36 houses found`);
  } else if (houseObjects.length > 0) {
    warn(`[${label}] Expected 36 houses, found ${houseObjects.length}`);
  }
}

function validateVillageTemplate(data) {
  const label = 'village_template';
  const mapWidthPx = data.width * data.tilewidth;
  const mapHeightPx = data.height * data.tileheight;

  log(`[${label}] Dimensions: ${data.width}x${data.height} tiles, ${data.tilewidth}x${data.tileheight}px tile size`);
  log(`[${label}] Pixel size: ${mapWidthPx}x${mapHeightPx}`);

  // Map properties
  const mapId = getMapProperty(data, 'mapId');
  const mapType = getMapProperty(data, 'mapType');
  const defaultSpawn = getMapProperty(data, 'defaultSpawn');
  const templateId = getMapProperty(data, 'templateId');
  const instanceMode = getMapProperty(data, 'instanceMode');
  const houseCapacity = getMapProperty(data, 'houseCapacity');
  const tileSize = getMapProperty(data, 'tileSize');

  log(`[${label}] Map properties:`);
  if (data.properties) {
    for (const p of data.properties) {
      log(`  - ${p.name}: ${p.value} (${p.type})`);
    }
  }

  // Validate expected properties
  const checks = [
    { name: 'mapId', expected: 'main_village_template', actual: mapId },
    { name: 'mapType', expected: 'village_template', actual: mapType },
    { name: 'defaultSpawn', expected: 'village_instance_entry', actual: defaultSpawn },
    { name: 'templateId', expected: 'main_village_template', actual: templateId },
    { name: 'instanceMode', expected: 'dynamic', actual: instanceMode },
    { name: 'houseCapacity', expected: 36, actual: houseCapacity },
    { name: 'tileSize', expected: 32, actual: tileSize },
  ];

  for (const check of checks) {
    if (check.actual === undefined) {
      error(`[${label}] Missing property: ${check.name} (expected: ${check.expected})`);
    } else if (String(check.actual) !== String(check.expected)) {
      warn(`[${label}] Property ${check.name}: expected "${check.expected}", got "${check.actual}"`);
    } else {
      log(`[${label}] [PASS] ${check.name} = ${check.actual}`);
    }
  }

  // Check tilesets
  checkExternalSources(data.tilesets || [], label);
  log(`[${label}] Tilesets declared: ${(data.tilesets || []).length}`);

  const tmjDir = dirname(VILLAGE_TEMPLATE_PATH);
  checkTilesetImages(data.tilesets || [], tmjDir, label);

  // Layers
  const allLayers = getLayerNames(data.layers || []);
  const allObjects = getAllObjects(data.layers || []);
  const types = countObjectTypes(allObjects);

  log(`[${label}] Total layers: ${allLayers.length}`);
  log(`[${label}] Object counts: rectangles=${types.rectangles}, polygons=${types.polygons}, points=${types.points}, polylines=${types.polylines}, tiles=${types.tiles}`);

  // Check for village_instance_entry_spawn
  const entrySpawn = allObjects.find(o => (o.name || '').toLowerCase().includes('village_instance_entry_spawn'));
  if (entrySpawn) {
    log(`[${label}] [PASS] village_instance_entry_spawn found`);
  } else {
    error(`[${label}] Missing: village_instance_entry_spawn`);
  }

  // Check for village_instance_exit_gateway
  const exitGateway = allObjects.find(o => (o.name || '').toLowerCase().includes('village_instance_exit_gateway'));
  if (exitGateway) {
    log(`[${label}] [PASS] village_instance_exit_gateway found`);
  } else {
    error(`[${label}] Missing: village_instance_exit_gateway`);
  }

  // Check for village_instance_zone
  const instanceZone = allObjects.find(o => (o.name || '').toLowerCase().includes('village_instance_zone'));
  if (instanceZone) {
    log(`[${label}] [PASS] village_instance_zone found`);
  } else {
    error(`[${label}] Missing: village_instance_zone`);
  }

  // Check that houses do NOT have a fixed villageId
  const houseObjects = allObjects.filter(o => {
    const name = (o.name || '').toLowerCase();
    const type = (o.type || '').toLowerCase();
    return name.includes('house') || type.includes('house');
  });

  let fixedVillageIdCount = 0;
  for (const h of houseObjects) {
    const villageId = getProperty(h, 'villageId');
    if (villageId && villageId !== '' && villageId !== 'dynamic') {
      fixedVillageIdCount++;
    }
  }
  if (fixedVillageIdCount === 0) {
    log(`[${label}] [PASS] No fixed villageId on houses`);
  } else {
    warn(`[${label}] ${fixedVillageIdCount} houses have a fixed villageId`);
  }

  // Count house entries
  const houseEntries = allObjects.filter(o => {
    const name = (o.name || '').toLowerCase();
    return name.includes('house_entry') || name.includes('house_door') || name.includes('house_spawn');
  });
  log(`[${label}] House entry/door/spawn objects: ${houseEntries.length}`);

  if (houseObjects.length === 36) {
    log(`[${label}] [PASS] 36 house objects found`);
  } else if (houseObjects.length > 0) {
    warn(`[${label}] Expected 36 houses, found ${houseObjects.length}`);
  }

  // Check boundary collisions (4 map-edge collisions)
  const collisionObjects = allObjects.filter(o => {
    const layerName = (o._layerName || '').toLowerCase();
    return layerName.includes('collision') || layerName.includes('boundary') || layerName.includes('limit');
  });

  const boundaryCollisions = collisionObjects.filter(o => {
    const name = (o.name || '').toLowerCase();
    const w = o.width || 0;
    const h = o.height || 0;
    const isBoundary = name.includes('boundary') || name.includes('border') || name.includes('limit');
    const isLarge = (w >= mapWidthPx * 0.8) || (h >= mapHeightPx * 0.8);
    return isBoundary || isLarge;
  });

  if (boundaryCollisions.length >= 4) {
    log(`[${label}] [PASS] ${boundaryCollisions.length} boundary collisions found`);
  } else {
    log(`[${label}] Boundary collision objects detected: ${boundaryCollisions.length} (expected 4 map-edge collisions)`);
    log(`[${label}] Total collision-layer objects: ${collisionObjects.length}`);
  }

  // Out of bounds
  const outOfBounds = checkOutOfBounds(allObjects, mapWidthPx, mapHeightPx, label);
  if (outOfBounds > 0) {
    warn(`[${label}] ${outOfBounds} objects significantly outside map bounds`);
  }

  // List all layers
  log(`[${label}] --- All layers ---`);
  for (const l of allLayers) {
    log(`  ${l.type.padEnd(12)} ${l.fullName}`);
  }

  // Custom properties on objects
  const propsUsed = new Set();
  for (const obj of allObjects) {
    if (obj.properties) {
      for (const p of obj.properties) {
        propsUsed.add(p.name);
      }
    }
  }
  if (propsUsed.size > 0) {
    log(`[${label}] Custom properties used on objects: ${[...propsUsed].sort().join(', ')}`);
  }
}

// --- Main ---
console.log('='.repeat(60));
console.log('  Chess World v2 - Map Validation Script');
console.log('='.repeat(60));
console.log();

const mainWorld = loadJSON(MAIN_WORLD_PATH, 'main_world');
const villageTemplate = loadJSON(VILLAGE_TEMPLATE_PATH, 'village_template');

if (mainWorld) {
  console.log('--- Validating Main World ---');
  validateMainWorld(mainWorld);
}

if (villageTemplate) {
  console.log('\n--- Validating Village Template ---');
  validateVillageTemplate(villageTemplate);
}

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log('  VALIDATION SUMMARY');
console.log('='.repeat(60));

if (errors.length > 0) {
  console.log(`\n  ERRORS (${errors.length}):`);
  for (const e of errors) {
    console.log(`    [ERROR] ${e}`);
  }
}

if (warnings.length > 0) {
  console.log(`\n  WARNINGS (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`    [WARN]  ${w}`);
  }
}

if (info.length > 0) {
  console.log(`\n  INFO (${info.length} lines):`);
  for (const i of info) {
    console.log(`    ${i}`);
  }
}

console.log('\n' + '-'.repeat(60));
console.log(`  Results: ${errors.length} errors, ${warnings.length} warnings, ${info.length} info`);

if (errors.length === 0 && warnings.length === 0) {
  console.log('  STATUS: ALL CHECKS PASSED');
} else if (errors.length === 0) {
  console.log('  STATUS: PASSED WITH WARNINGS');
} else {
  console.log('  STATUS: FAILED - Fix errors before proceeding');
}

console.log('-'.repeat(60));
process.exit(errors.length > 0 ? 1 : 0);
