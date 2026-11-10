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

  // ===== 0. 创建普通用户表 & 论坛表 =====
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 修复核心：补齐论坛相关表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS forum_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      location TEXT,
      tags TEXT,
      pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS forum_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE
    )
  `);

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

  // ===== 6. 强行补全光谷世界城的楼层与店铺名 =====
  console.log('正在检查并修复世界城的楼层与店铺...');
  const fixMap = {
    '土掉渣猪肉烧饼': { shop: '烧饼部落', floor: null },
    '土掉渣芝麻甜饼': { shop: '烧饼部落', floor: null },
    '芝士榴莲烧饼': { shop: '烧饼部落', floor: null },
    '三文鱼寿司': { shop: '寿司郎', floor: null },
    '金枪鱼寿司': { shop: '寿司郎', floor: null },
    '天妇罗拼盘': { shop: '寿司郎', floor: null },
    '招牌干锅大王鸡': { shop: '小馋妮', floor: 2 },
    '鸡虾双拼干锅': { shop: '小馋妮', floor: 2 },
    '一锅两吃': { shop: '小馋妮', floor: 2 },
    '面包诱惑': { shop: '绿茶', floor: 4 },
    '绿茶烤鸡': { shop: '绿茶', floor: 4 },
    '粉丝裹虾': { shop: '绿茶', floor: 4 },
    '石锅鸡汤豆腐': { shop: '绿茶', floor: 4 },
    '炙烧鹅肝寿司': { shop: '滨寿司', floor: 5 },
    '茶碗蒸': { shop: '滨寿司', floor: 5 },
    '虾三味寿司': { shop: '滨寿司', floor: 5 },
    '蒲烧鳗鱼寿司': { shop: '滨寿司', floor: 5 },
    '招牌肉蟹煲': { shop: '胖哥俩肉蟹煲', floor: 5 },
    '明虾煲': { shop: '胖哥俩肉蟹煲', floor: 5 },
    '鸡爪煲': { shop: '胖哥俩肉蟹煲', floor: 5 },
    '红糖糍粑': { shop: '胖哥俩肉蟹煲', floor: 5 },
    '梅菜扣肉煲仔饭': { shop: '秀玉', floor: 5 },
    '托斯卡纳风味海鲜锅': { shop: '秀玉', floor: 5 },
    '扒澳洲西冷': { shop: '秀玉', floor: 5 },
    '黑椒小龙虾意面': { shop: '秀玉', floor: 5 },
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
    '柴记辣子鸡': { shop: '柴记', floor: 5 },
    '石锅髮菜豆腐': { shop: '柴记', floor: 5 },
    '江湖坨坨虾': { shop: '柴记', floor: 5 },
    '飞刀土豆片': { shop: '柴记', floor: 5 },
    '铫子筒骨煨藕汤': { shop: '来菜', floor: 5 },
    '三镇干煸藕丝': { shop: '来菜', floor: 5 },
    '洪湖脆藕煎鲈鱼': { shop: '来菜', floor: 5 },
    '烧椒皮蛋茄子': { shop: '来菜', floor: 5 },
    '吊龙': { shop: '潮牛壹号火锅', floor: 5 },
    '嫩肉': { shop: '潮牛壹号火锅', floor: 5 },
    '手打牛肉丸': { shop: '潮牛壹号火锅', floor: 5 },
    '潮牛原骨汤锅': { shop: '潮牛壹号火锅', floor: 5 },
    '辣不怂招牌辣子鸡': { shop: '辣不怂', floor: 5 }
  };

  let fixedCount = 0;
  for (const [keyword, info] of Object.entries(fixMap)) {
    const res = await client.execute({
      sql: `UPDATE recommendations SET shop = ?, floor = ? WHERE name LIKE ? AND (shop IS NULL OR shop = '' OR shop = '其他店铺')`,
      args: [info.shop, info.floor, `%${keyword}%`]
    });
    if (res.rowsAffected > 0) {
      fixedCount += res.rowsAffected;
    }
  }
  
  if (fixedCount > 0) {
    console.log(`✓ 成功自动修复 ${fixedCount} 道世界城菜品的楼层与店铺名！`);
  } else {
    console.log(`✓ 世界城数据已是最新，无需修复。`);
  }

  // ===== 7. 论坛初始内容 =====
  const forumUsers = [
    ['forum-campus-guide', 'forum_system_guide', '校园向导'],
    ['forum-food-reviewer', 'forum_system_reviewer', '食堂观察员'],
    ['forum-life-helper', 'forum_system_life', '生活委员'],
  ];
  for (const [id, username, nickname] of forumUsers) {
    await client.execute({
      sql: `INSERT INTO users (id, username, password_hash, nickname)
            VALUES (?, ?, 'disabled:disabled', ?) ON CONFLICT(id) DO NOTHING`,
      args: [id, username, nickname],
    });
  }

  const forumPostCount = (await client.execute('SELECT COUNT(*) AS count FROM forum_posts')).rows[0].count;
  if (Number(forumPostCount) === 0) {
    const initialPosts = [
      {
        id: 'forum-welcome-001',
        userId: 'forum-campus-guide',
        category: 'campus',
        title: '校园论坛正式开放，请从一条真实分享开始',
        content: '这里可以交流食堂测评、拼饭邀约、求推荐和校园生活信息。发帖和评论需要登录，所有内容会同步保存在服务端。\n\n请尽量写清时间、地点、价格和真实体验；尊重不同口味，也请勿发布个人隐私或未经核实的信息。',
        location: '华中科技大学',
        tags: ['新手指南', '社区公约'],
        pinned: 1,
        createdAt: "datetime('now', '-30 minutes')",
      },
      {
        id: 'forum-review-001',
        userId: 'forum-food-reviewer',
        category: 'review',
        title: '最近在东一食堂发现了哪些值得复购的菜？',
        content: '欢迎把最近吃到的窗口、菜品、价格和排队时间写在评论里。比起一句“好吃”，具体口味和份量更能帮助其他同学做决定。',
        location: '东一食堂',
        tags: ['东一食堂', '食堂测评'],
        pinned: 0,
        createdAt: "datetime('now', '-5 hours')",
      },
      {
        id: 'forum-ask-001',
        userId: 'forum-life-helper',
        category: 'ask',
        title: '求一份适合赶晚课的快餐清单',
        content: '最近晚课前时间比较紧，希望找 15 分钟内能吃完、预算 15 元左右的校内选择。东边和中区都可以，欢迎分享真实体验。',
        location: '东区',
        tags: ['求推荐', '快餐', '晚课'],
        pinned: 0,
        createdAt: "datetime('now', '-9 hours')",
      },
    ];
    for (const post of initialPosts) {
      await client.execute({
        sql: `INSERT INTO forum_posts
              (id, user_id, category, title, content, location, tags, pinned, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${post.createdAt}, ${post.createdAt})`,
        args: [post.id, post.userId, post.category, post.title, post.content, post.location, JSON.stringify(post.tags), post.pinned],
      });
    }
    await client.execute({
      sql: `INSERT INTO forum_comments (id, post_id, user_id, content, created_at)
            VALUES (?, ?, ?, ?, datetime('now', '-2 hours'))`,
      args: ['forum-comment-welcome-001', 'forum-welcome-001', 'forum-life-helper', '收到！期待大家在论坛里真实分享、有用的校园信息。'],
    });
  }

  console.log(`✓ 云端数据库检查完毕，成功注入 ${matchedCount} 种基础评分`);
}
