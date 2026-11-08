import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

export default async function init(client) {
  const seed = JSON.parse(readFileSync(join(directory, 'seed.json'), 'utf8'));
  let baseRatings = {};
  try {
    baseRatings = JSON.parse(readFileSync(join(directory, 'ratings.json'), 'utf8'));
  } catch (e) {
    console.log('未找到 ratings.json，跳过基础评分注入');
  }

  await client.execute('PRAGMA foreign_keys = ON');
  await client.executeMultiple(readFileSync(join(directory, 'schema.sql'), 'utf8'));

  // ===== 1. 更新 places 表 =====
  const placesInfo = await client.execute('PRAGMA table_info(places)');
  const placeColumns = new Set(placesInfo.rows.map(c => c.name));
  if (!placeColumns.has('map_x')) await client.execute('ALTER TABLE places ADD COLUMN map_x REAL');
  if (!placeColumns.has('map_y')) await client.execute('ALTER TABLE places ADD COLUMN map_y REAL');
  if (!placeColumns.has('longitude')) await client.execute('ALTER TABLE places ADD COLUMN longitude REAL');
  if (!placeColumns.has('latitude')) await client.execute('ALTER TABLE places ADD COLUMN latitude REAL');
  if (!placeColumns.has('coordinate_source')) await client.execute('ALTER TABLE places ADD COLUMN coordinate_source TEXT');
  if (!placeColumns.has('location_status')) await client.execute("ALTER TABLE places ADD COLUMN location_status TEXT NOT NULL DEFAULT '未定位'");

  // ===== 2. 更新 feedback 表 =====
  const feedbackInfo = await client.execute('PRAGMA table_info(feedback)');
  const feedbackColumns = new Set(feedbackInfo.rows.map(c => c.name));
  if (!feedbackColumns.has('tracking_code')) {
    await client.execute('ALTER TABLE feedback RENAME TO feedback_legacy;');
    await client.execute(`
      CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tracking_code TEXT UNIQUE, place_id TEXT REFERENCES places(id),
        proposed_place_name TEXT, feedback_type TEXT NOT NULL, details TEXT NOT NULL, proposed_payload TEXT,
        review_status TEXT NOT NULL DEFAULT '待审核', review_note TEXT, submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
      );
    `);
    await client.execute(`
      INSERT INTO feedback (id, place_id, proposed_place_name, feedback_type, details, review_status, submitted_at, reviewed_at)
      SELECT id, place_id, proposed_place_name, CASE WHEN feedback_type = '菜单或营业信息错误' THEN '其他' ELSE feedback_type END, details, review_status, submitted_at, reviewed_at FROM feedback_legacy;
    `);
    await client.execute('DROP TABLE feedback_legacy;');
    await client.execute('CREATE INDEX IF NOT EXISTS feedback_review_status ON feedback (review_status);');
    await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS feedback_tracking_code ON feedback (tracking_code);');
  }

  // ===== 3. 更新 recommendations 表 =====
  const recsInfo = await client.execute('PRAGMA table_info(recommendations)');
  const recColumns = new Set(recsInfo.rows.map(c => c.name));
  if (!recColumns.has('rating')) await client.execute('ALTER TABLE recommendations ADD COLUMN rating REAL DEFAULT 3.0');
  if (!recColumns.has('rating_count')) await client.execute('ALTER TABLE recommendations ADD COLUMN rating_count INTEGER DEFAULT 0');
  if (!recColumns.has('tags')) await client.execute('ALTER TABLE recommendations ADD COLUMN tags TEXT');
  if (!recColumns.has('shop')) await client.execute('ALTER TABLE recommendations ADD COLUMN shop TEXT');

  // ===== 4. 导入 seed 数据 =====
  const placesCountRes = await client.execute('SELECT COUNT(*) as count FROM places');
  const placesCount = placesCountRes.rows[0].count;

  if (placesCount === 0) {
    console.log('检测到空数据库，正在导入 seed.json 初始数据...');
    const topLevel = seed.places.filter(p => !p.parentId);
    const children = seed.places.filter(p => p.parentId);
    
    for (const place of [...topLevel, ...children]) {
      await client.execute({
        sql: `INSERT INTO places (id, name, place_type, source_group, parent_id, campus_area, location_note, map_x, map_y, longitude, latitude, coordinate_source, location_status, source_label, verification_status, last_confirmed_at) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        args: [place.id, place.name, place.placeType, place.sourceGroup, place.parentId ?? null, place.campusArea ?? null, place.locationNote ?? null, place.mapX ?? null, place.mapY ?? null, place.longitude ?? null, place.latitude ?? null, place.coordinateSource ?? null, place.locationStatus ?? '未定位', place.sourceLabel, place.verificationStatus ?? '待确认', place.lastConfirmedAt ?? null]
      });
    }

    for (const item of seed.recommendations) {
      await client.execute({
        sql: `INSERT INTO recommendations (id, place_id, name, floor, note, shop, source_label, meal_period, verification_status, rating, rating_count, tags) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        args: [item.id, item.placeId, item.name, (item.floor && item.floor >= 1 && item.floor <= 99) ? item.floor : null, item.note ?? null, item.shop ?? null, item.sourceLabel ?? item.name ?? '', item.mealPeriod ?? null, item.verificationStatus ?? '待确认', item.rating ?? 3.0, item.ratingCount ?? 0, item.tags ? JSON.stringify(item.tags) : null]
      });
    }
    console.log('✓ 初始数据导入完成');
  } else {
    console.log('✓ 数据库已有数据，跳过 seed.json 导入。');
  }

  // ===== 5. 将 ratings.json 基础评分注入云端数据库 =====
  let matchedCount = 0;
  for (const item of seed.recommendations) {
    let score = baseRatings[item.name];
    if (score === undefined) {
      const cleanName = item.name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/整体/g, '');
      score = baseRatings[cleanName];
    }
    if (score !== undefined) {
      if (item.rating === undefined || item.ratingCount === 0) {
        await client.execute({
          sql: `UPDATE recommendations SET rating = ?, rating_count = 3 WHERE name = ? AND (rating_count IS NULL OR rating_count = 0)`,
          args: [score, item.name]
        });
        matchedCount++;
      }
    }
  }

     // ===== 6. 强行补全光谷世界城丢失的店铺名（绝对精确版） =====
  console.log('正在检查并自动分配世界城的店铺名...');
  
      // ===== 6. 强行补全光谷世界城的楼层与店铺名（最终终极精确版） =====
  console.log('正在检查并修复世界城的楼层与店铺...');

  const fixMap = {
        // -1 楼 (烧饼部落 & 寿司郎)
    '土掉渣猪肉烧饼': { shop: '烧饼部落', floor: null },
    '土掉渣芝麻甜饼': { shop: '烧饼部落', floor: null },
    '芝士榴莲烧饼': { shop: '烧饼部落', floor: null },
    '三文鱼寿司': { shop: '寿司郎', floor: null },
    '金枪鱼寿司': { shop: '寿司郎', floor: null },
    '天妇罗拼盘': { shop: '寿司郎', floor: null },

    // 2 楼 (小馋妮)
    '招牌干锅大王鸡': { shop: '小馋妮', floor: 2 },
    '鸡虾双拼干锅': { shop: '小馋妮', floor: 2 },
    '一锅两吃': { shop: '小馋妮', floor: 2 },

    // 4 楼 (绿茶)
    '面包诱惑': { shop: '绿茶', floor: 4 },
    '绿茶烤鸡': { shop: '绿茶', floor: 4 },
    '粉丝裹虾': { shop: '绿茶', floor: 4 },
    '石锅鸡汤豆腐': { shop: '绿茶', floor: 4 },

    // 5 楼 (滨寿司)
    '炙烧鹅肝寿司': { shop: '滨寿司', floor: 5 },
    '茶碗蒸': { shop: '滨寿司', floor: 5 },
    '虾三味寿司': { shop: '滨寿司', floor: 5 },
    '蒲烧鳗鱼寿司': { shop: '滨寿司', floor: 5 },

    // 5 楼 (胖哥俩)
    '招牌肉蟹煲': { shop: '胖哥俩肉蟹煲', floor: 5 },
    '明虾煲': { shop: '胖哥俩肉蟹煲', floor: 5 },
    '鸡爪煲': { shop: '胖哥俩肉蟹煲', floor: 5 },
    '红糖糍粑': { shop: '胖哥俩肉蟹煲', floor: 5 },

    // 5 楼 (秀玉)
    '梅菜扣肉煲仔饭': { shop: '秀玉', floor: 5 },
    '托斯卡纳风味海鲜锅': { shop: '秀玉', floor: 5 },
    '扒澳洲西冷': { shop: '秀玉', floor: 5 },
    '黑椒小龙虾意面': { shop: '秀玉', floor: 5 },

    // 5 楼 (浪小贝潮汕海鲜锅)
    '招牌干贝鲜虾粥': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '白贝粥': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '膏蟹粥': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '黄油焗牙片鱼头': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '黄油焗贝贝南瓜': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '黄油焗梭子蟹': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '蒜蓉焗花甲': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '茄子年糕煲': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '盐焗手撕鸡': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '脆皮香酥鸭': { shop: '浪小贝潮汕海鲜锅', floor: 5 },
    '豆豉鲮鱼油麦菜': { shop: '浪小贝潮汕海鲜锅', floor: 5 },

    // 5 楼 (柴记)
    '柴记辣子鸡': { shop: '柴记', floor: 5 },
    '石锅髮菜豆腐': { shop: '柴记', floor: 5 },
    '江湖坨坨虾': { shop: '柴记', floor: 5 },
    '飞刀土豆片': { shop: '柴记', floor: 5 },

    // 5 楼 (来菜)
    '铫子筒骨煨藕汤': { shop: '来菜', floor: 5 },
    '三镇干煸藕丝': { shop: '来菜', floor: 5 },
    '洪湖脆藕煎鲈鱼': { shop: '来菜', floor: 5 },
    '烧椒皮蛋茄子': { shop: '来菜', floor: 5 },

    // 5 楼 (潮牛壹号火锅)
    '吊龙': { shop: '潮牛壹号火锅', floor: 5 },
    '嫩肉': { shop: '潮牛壹号火锅', floor: 5 },
    '手打牛肉丸': { shop: '潮牛壹号火锅', floor: 5 },
    '潮牛原骨汤锅': { shop: '潮牛壹号火锅', floor: 5 },

    // 5 楼 (辣不怂)
    '辣不怂招牌辣子鸡': { shop: '辣不怂', floor: 5 }
  };

  let fixedCount = 0;
  for (const [keyword, info] of Object.entries(fixMap)) {
    // 使用 LIKE 模糊匹配，强制覆盖楼层和店铺名，不放过任何带括号、斜杠的菜名
        // 👇 加上了 AND 判断，只有原来没店铺或楼层不对时，才去更新
    const res = await client.execute({
      sql: `UPDATE recommendations SET shop = ?, floor = ? WHERE name LIKE ? AND (shop IS NULL OR shop = '' OR shop = '其他店铺')`,
      args: [info.shop, info.floor, `%${keyword}%`]
    });
    if (res.rowsAffected > 0) {
      fixedCount += res.rowsAffected;
      console.log(`✓ 修复：${keyword} -> ${info.floor === -1 ? 'B1' : info.floor + '楼'} ${info.shop}`);
    }
  }
  
  if (fixedCount > 0) {
    console.log(`✓ 成功自动修复 ${fixedCount} 道世界城菜品的楼层与店铺名！`);
  } else {
    console.log(`✓ 世界城数据已是最新，无需修复。`);
  }
  console.log(`✓ 云端数据库检查完毕，成功注入 ${matchedCount} 种基础评分`);
}