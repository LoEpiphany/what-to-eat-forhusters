// 从 OSM Overpass API 获取华科校园建筑数据，转换为 GeoJSON 保存
import https from 'node:https';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const BBOX = [30.500, 114.380, 30.533, 114.450]; // south, west, north, east

const query = `[out:json][timeout:90];
(
  way["building"](${BBOX[0]},${BBOX[1]},${BBOX[2]},${BBOX[3]});
  relation["building"](${BBOX[0]},${BBOX[1]},${BBOX[2]},${BBOX[3]});
);
out body;
>;
out skel qt;`;

function fetchOverpass(endpoint) {
  return new Promise((resolve, reject) => {
    const postData = `data=${encodeURIComponent(query)}`;
    const url = new URL(endpoint);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json',
        'User-Agent': 'hust-campus-map/1.0',
      },
      timeout: 120000,
    };

    console.log(`尝试 ${endpoint} ...`);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON 解析失败: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
    req.write(postData);
    req.end();
  });
}

async function fetchFromAnyEndpoint() {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const data = await fetchOverpass(endpoint);
      console.log(`✓ 从 ${endpoint} 获取成功，共 ${data.elements.length} 个元素`);
      return data;
    } catch (e) {
      console.log(`  ✗ ${endpoint} 失败: ${e.message}`);
    }
  }
  throw new Error('所有 Overpass 端点都失败了');
}

// OSM JSON 转 GeoJSON (简化版，只处理建筑多边形)
function osmToGeoJSON(osmData) {
  const nodes = new Map();
  const ways = new Map();
  const relations = [];

  for (const el of osmData.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, el);
    } else if (el.type === 'way') {
      ways.set(el.id, el);
    } else if (el.type === 'relation') {
      relations.push(el);
    }
  }

  const features = [];

  // 处理普通建筑 way
  for (const way of ways.values()) {
    if (!way.tags || !way.tags.building) continue;
    if (!way.nodes || way.nodes.length < 4) continue; // 至少 4 个点才是闭合多边形

    const coords = [];
    let valid = true;
    for (const nodeId of way.nodes) {
      const node = nodes.get(nodeId);
      if (!node) { valid = false; break; }
      coords.push([node.lon, node.lat]);
    }
    if (!valid) continue;

    // 确保是闭合的
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
      continue;
    }

    features.push({
      type: 'Feature',
      properties: {
        name: way.tags.name || '',
        building: way.tags.building || 'yes',
        levels: way.tags['building:levels'] || '',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [coords],
      },
    });
  }

  // 处理 multipolygon relation (简单处理外环)
  for (const rel of relations) {
    if (!rel.tags || !rel.tags.building) continue;
    if (rel.tags.type !== 'multipolygon') continue;

    const outerRings = [];
    for (const member of rel.members) {
      if (member.type !== 'way') continue;
      if (member.role !== 'outer' && member.role !== '') continue;
      const way = ways.get(member.ref);
      if (!way || !way.nodes) continue;

      const coords = [];
      let valid = true;
      for (const nodeId of way.nodes) {
        const node = nodes.get(nodeId);
        if (!node) { valid = false; break; }
        coords.push([node.lon, node.lat]);
      }
      if (!valid) continue;
      outerRings.push(coords);
    }

    if (outerRings.length === 0) continue;

    // 找最大的外环作为主多边形
    let maxRing = outerRings[0];
    let maxArea = 0;
    for (const ring of outerRings) {
      const area = ringArea(ring);
      if (area > maxArea) { maxArea = area; maxRing = ring; }
    }

    if (maxRing.length < 4) continue;
    if (maxRing[0][0] !== maxRing[maxRing.length - 1][0] || maxRing[0][1] !== maxRing[maxRing.length - 1][1]) continue;

    features.push({
      type: 'Feature',
      properties: {
        name: rel.tags.name || '',
        building: rel.tags.building || 'yes',
        levels: rel.tags['building:levels'] || '',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [maxRing],
      },
    });
  }

  console.log(`生成 ${features.length} 个建筑多边形`);
  const namedCount = features.filter(f => f.properties.name).length;
  console.log(`其中 ${namedCount} 个有名称`);

  return {
    type: 'FeatureCollection',
    features,
  };
}

function ringArea(coords) {
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
  }
  return Math.abs(area / 2);
}

async function main() {
  try {
    const osmData = await fetchFromAnyEndpoint();

    // 保存原始 OSM 数据（可选）
    writeFileSync(
      join('data', 'hust_buildings_osm.json'),
      JSON.stringify(osmData),
      'utf8'
    );

    // 转换为 GeoJSON
    const geojson = osmToGeoJSON(osmData);

    // 保存 GeoJSON
    writeFileSync(
      join('data', 'hust_buildings.geojson'),
      JSON.stringify(geojson),
      'utf8'
    );

    console.log('✓ 数据已保存到 data/hust_buildings.geojson');
    console.log(`  文件大小: ${(JSON.stringify(geojson).length / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.error('✗ 失败:', e.message);
    process.exit(1);
  }
}

main();
