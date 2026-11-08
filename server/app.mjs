import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHmac, scryptSync } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const pagePath = fileURLToPath(new URL('../index.html', import.meta.url));
const scriptPath = fileURLToPath(new URL('../app.js', import.meta.url));
const seedPath = fileURLToPath(new URL('../database/seed.json', import.meta.url));

const placeColumns = `id, name, place_type, source_group, parent_id, campus_area, location_note, map_x, map_y, longitude, latitude, coordinate_source, location_status, source_label, verification_status, last_confirmed_at`;
const recommendationColumns = `id, place_id, name, floor, note, shop, meal_period, source_label, verification_status, rating, rating_count, tags`;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readJsonBody(request, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求内容过大')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } 
      catch { reject(new Error('JSON 格式不正确')); }
    });
    request.on('error', reject);
  });
}

function createTrackingCode() {
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((r, p) => ({ ...r, [p.type]: p.value }), {});
  return `FB-${date.year}${date.month}${date.day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function mapFeedback(row) {
  return { trackingCode: row.tracking_code, placeId: row.place_id, proposedPlaceName: row.proposed_place_name, feedbackType: row.feedback_type, details: row.details, status: row.review_status, reviewNote: row.review_note, submittedAt: row.submitted_at, reviewedAt: row.reviewed_at };
}

function mapRecommendation(row) {
  return {
    id: row.id, placeId: row.place_id, name: row.name, floor: row.floor, note: row.note, 
    shop: row.shop || null, // 👈 加上这一行，把店铺名返回给前端
    mealPeriod: row.meal_period,
    sourceLabel: row.source_label, verificationStatus: row.verification_status === '已核实' ? '已确认' : row.verification_status,
    rating: row.rating !== null ? row.rating : 3.0, ratingCount: row.rating_count !== null ? row.rating_count : 0,
    tags: (() => { try { return row.tags ? JSON.parse(row.tags) : []; } catch { return []; } })(),
  };
}

function mapPlace(row, recommendations) {
  return {
    id: row.id, name: row.name, placeType: row.place_type, sourceGroup: row.source_group, parentId: row.parent_id,
    campusArea: row.campus_area, locationNote: row.location_note, mapX: row.map_x, mapY: row.map_y, longitude: row.longitude,
    latitude: row.latitude, coordinateSource: row.coordinate_source, locationStatus: row.location_status, sourceLabel: row.source_label,
    verificationStatus: row.verification_status === '已核实' ? '已确认' : row.verification_status, lastConfirmedAt: row.last_confirmed_at,
    recommendations,
  };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, hash) {
  try {
    const [salt, key] = hash.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = scryptSync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

export function createApp(client) {
  const adminUsername = process.env.ADMIN_USERNAME ?? 'jintianchishenme';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'helloworld';
 
  const sessionTtlMs = 8 * 60 * 60 * 1000;
  const sameSecret = (left, right) => {
    const a = Buffer.from(String(left)), b = Buffer.from(String(right));
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const sessionSecret = process.env.JWT_SECRET || 'hust-map-secret-key';
  
  // 验票逻辑
  const sessionFor = request => {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    try {
      const [base64, hmac] = token.split('.');
      if (!base64 || !hmac) return null;
      // 验证签名是否正确
      const expected = createHmac('sha256', sessionSecret).update(base64).digest('base64url');
      if (hmac !== expected) return null;
      // 解析出用户信息
      const data = JSON.parse(Buffer.from(base64, 'base64url').toString());
      return { token, username: data.username, userId: data.userId, role: data.role };
    } catch {
      return null;
    }
  };
  
  // 辅助查询函数
  async function getAllPlacesWithRecs() {
    const placesRes = await client.execute(`SELECT ${placeColumns} FROM places ORDER BY CASE source_group WHEN '食堂' THEN 0 ELSE 1 END, name`);
    const recsRes = await client.execute(`SELECT ${recommendationColumns} FROM recommendations ORDER BY place_id, COALESCE(floor, 0), id`);
    const grouped = new Map();
    for (const row of recsRes.rows) {
      const items = grouped.get(row.place_id) ?? [];
      items.push(mapRecommendation(row));
      grouped.set(row.place_id, items);
    }
    return placesRes.rows.map(row => mapPlace(row, grouped.get(row.id) ?? []));
  }

  const validFeedbackTypes = new Set(['还在这里', '位置有误', '名称有误', '楼层入口错误', '菜品信息有误', '营业时间有误', '暂停营业', '新增位置', '其他']);

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;

      if (request.method === 'GET' && path === '/api/health') return sendJson(response, 200, { status: 'ok' });

      if (request.method === 'POST' && path === '/api/admin/login') {
        const body = await readJsonBody(request, 4 * 1024);
        if (!sameSecret(body.username || '', adminUsername) || !sameSecret(body.password || '', adminPassword)) {
          return sendJson(response, 401, { error: 'invalid_credentials', message: '管理员账号或密码不正确' });
        }
        const payload = Buffer.from(JSON.stringify({ username: adminUsername, exp: Date.now() + sessionTtlMs })).toString('base64url');
        const hmac = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
        const token = `${payload}.${hmac}`;
        return sendJson(response, 200, { token, user: { username: adminUsername, role: 'admin' }, expiresIn: sessionTtlMs / 1000 });
      }
            // ===== 用户注册 =====
      if (request.method === 'POST' && path === '/api/user/register') {
        const body = await readJsonBody(request);
        if (!body.username || !body.password) return sendJson(response, 400, { error: '请填写账号密码' });

        const existing = await client.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [body.username] });
        if (existing.rows.length > 0) return sendJson(response, 409, { error: '该用户名已被注册' });

        const id = randomBytes(8).toString('hex');
        await client.execute({
          sql: 'INSERT INTO users (id, username, password_hash, nickname) VALUES (?, ?, ?, ?)',
          args: [id, body.username, hashPassword(body.password), body.nickname || body.username]
        });
        return sendJson(response, 201, { ok: true, message: '注册成功' });
      }

      // ===== 用户登录 =====
      if (request.method === 'POST' && path === '/api/user/login') {
        const body = await readJsonBody(request);
        const res = await client.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [body.username] });
        const user = res.rows[0];

        if (!user || !verifyPassword(body.password, user.password_hash)) {
          return sendJson(response, 401, { error: '用户名或密码错误' });
        }

        const payload = Buffer.from(JSON.stringify({ userId: user.id, username: user.username, role: 'user', exp: Date.now() + sessionTtlMs })).toString('base64url');
        const hmac = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
        
        return sendJson(response, 200, { token: `${payload}.${hmac}`, user: { username: user.username, nickname: user.nickname } });
      }
      if (path.startsWith('/api/admin/')) {
        const session = sessionFor(request);
        if (!session) return sendJson(response, 401, { error: 'unauthorized', message: '请先以管理员身份登录' });
        
        if (request.method === 'POST' && path === '/api/admin/logout') { 
          return sendJson(response, 200, { ok: true }); 
        }
        if (request.method === 'GET' && path === '/api/admin/feedbacks') {
          const status = url.searchParams.get('status') === 'all' ? 'all' : '待审核';
          const res = await client.execute({ sql: `SELECT * FROM feedback WHERE (? = 'all' OR review_status = ?) ORDER BY CASE review_status WHEN '待审核' THEN 0 ELSE 1 END, submitted_at DESC`, args: [status, status] });
          return sendJson(response, 200, { feedbacks: res.rows.map(mapFeedback) });
        }
        if (request.method === 'GET' && path === '/api/admin/places') return sendJson(response, 200, { places: await getAllPlacesWithRecs() });
        
        // ===== 店铺管理 =====
        if (request.method === 'POST' && path === '/api/admin/places') {
          const b = await readJsonBody(request);
          await client.execute({ 
            sql: `INSERT INTO places (id, name, place_type, source_group, parent_id, campus_area, location_note, longitude, latitude, coordinate_source, location_status, source_label, verification_status, last_confirmed_at) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            args: [b.id, b.name, b.placeType || 'shop', b.sourceGroup || '校内', b.parentId, b.campusArea, b.locationNote, b.longitude, b.latitude, b.coordinateSource, b.locationStatus || '未定位', b.sourceLabel || b.name, b.verificationStatus || '待确认', new Date().toISOString().slice(0, 10)] 
          });
          return sendJson(response, 201, { ok: true });
        }
                if (request.method === 'PATCH' && path.startsWith('/api/admin/places/')) {
          const id = decodeURIComponent(path.split('/').pop());
          
          // 1. 去数据库里查出现有的旧数据
          const existingRes = await client.execute({ sql: 'SELECT * FROM places WHERE id = ?', args: [id] });
          const existing = existingRes.rows[0];
          if (!existing) {
            return sendJson(response, 404, { error: 'not_found', message: '地点不存在' });
          }

          const b = await readJsonBody(request);
          
          // 2. 如果前端没传这个字段，就用数据库里原有的值
          const name = b.name !== undefined ? b.name : existing.name;
          const placeType = b.placeType !== undefined ? b.placeType : existing.place_type;
          const sourceGroup = b.sourceGroup !== undefined ? b.sourceGroup : existing.source_group;
          const parentId = b.parentId !== undefined ? b.parentId : existing.parent_id;
          const campusArea = b.campusArea !== undefined ? b.campusArea : existing.campus_area;
          const locationNote = b.locationNote !== undefined ? b.locationNote : existing.location_note;
          const longitude = b.longitude !== undefined ? b.longitude : existing.longitude;
          const latitude = b.latitude !== undefined ? b.latitude : existing.latitude;
          const coordinateSource = b.coordinateSource !== undefined ? b.coordinateSource : existing.coordinate_source;
          const locationStatus = b.locationStatus !== undefined ? b.locationStatus : existing.location_status;
          const sourceLabel = b.sourceLabel !== undefined ? b.sourceLabel : existing.source_label;
          const verificationStatus = b.verificationStatus !== undefined ? b.verificationStatus : existing.verification_status;

          // 3. 执行更新
          await client.execute({
            sql: `UPDATE places SET name=?, place_type=?, source_group=?, parent_id=?, campus_area=?, location_note=?, longitude=?, latitude=?, coordinate_source=?, location_status=?, source_label=?, verification_status=? WHERE id=?`,
            args: [name, placeType, sourceGroup, parentId, campusArea, locationNote, longitude, latitude, coordinateSource, locationStatus, sourceLabel, verificationStatus, id]
          });
          
          return sendJson(response, 200, { ok: true });
        }
        if (request.method === 'DELETE' && path.startsWith('/api/admin/places/')) {
          const id = decodeURIComponent(path.split('/').pop());
          await client.execute({ sql: 'DELETE FROM recommendations WHERE place_id = ?', args: [id] });
          await client.execute({ sql: 'DELETE FROM places WHERE id = ?', args: [id] });
          return sendJson(response, 200, { ok: true });
        }

        // ===== 菜品管理 =====
        if (request.method === 'POST' && path === '/api/admin/recommendations') {
          const b = await readJsonBody(request);
          await client.execute({ 
            sql: `INSERT INTO recommendations (id, place_id, name, floor, note, source_label, meal_period, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
            args: [b.id, b.placeId, b.name, b.floor, b.note, b.sourceLabel || b.name, b.mealPeriod, b.verificationStatus || '待确认'] 
          });
          return sendJson(response, 201, { ok: true });
        }
        if (request.method === 'PATCH' && path.startsWith('/api/admin/recommendations/')) {
          const id = decodeURIComponent(path.split('/').pop());
          const b = await readJsonBody(request);
          await client.execute({
            sql: `UPDATE recommendations SET name=?, floor=?, note=?, source_label=?, meal_period=?, verification_status=? WHERE id=?`,
            args: [b.name, b.floor || null, b.note || null, b.sourceLabel || b.name, b.mealPeriod || null, b.verificationStatus || '待确认', id]
          });
          return sendJson(response, 200, { ok: true });
        }
        if (request.method === 'DELETE' && path.startsWith('/api/admin/recommendations/')) {
          const id = decodeURIComponent(path.split('/').pop());
          await client.execute({ sql: 'DELETE FROM recommendations WHERE id = ?', args: [id] });
          return sendJson(response, 200, { ok: true });
        }
        if (request.method === 'PATCH' && path.startsWith('/api/admin/feedbacks/')) {
          const code = decodeURIComponent(path.split('/').pop());
          const b = await readJsonBody(request);
          const status = b.decision === 'approve' ? '已批准' : b.decision === 'reject' ? '已驳回' : '';
          await client.execute({ sql: `UPDATE feedback SET review_status = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE tracking_code = ? AND review_status = '待审核'`, args: [status, b.reviewNote, code] });
          return sendJson(response, 200, { ok: true });
        }
        return sendJson(response, 404, { error: 'not_found' });
      }

      if (request.method === 'GET' && path === '/api/places') {
        return sendJson(response, 200, { places: await getAllPlacesWithRecs() });
      }

      if (request.method === 'POST' && path === '/api/rate') {
        const body = await readJsonBody(request);
        const recId = body.recommendationId;
        const score = Number(body.score);
        const newTags = Array.isArray(body.tags) ? body.tags : [];
        
        const existing = (await client.execute({ sql: 'SELECT rating, rating_count, tags FROM recommendations WHERE id = ?', args: [recId] })).rows[0];
        if (!existing) return sendJson(response, 404, { error: 'not_found' });

        const oldRating = existing.rating ?? 3.0;
        const oldCount = existing.rating_count ?? 0;
        const newCount = oldCount + 1;
        const newRating = (oldRating * oldCount + score) / newCount;

        let mergedTags = [];
        try { mergedTags = existing.tags ? JSON.parse(existing.tags) : []; } catch {}
        newTags.forEach(t => { if (!mergedTags.includes(t)) mergedTags.push(t); });

        await client.execute({ sql: 'UPDATE recommendations SET rating = ?, rating_count = ?, tags = ? WHERE id = ?', args: [newRating, newCount, JSON.stringify(mergedTags), recId] });
        
        return sendJson(response, 200, { ok: true, rating: newRating, ratingCount: newCount, tags: mergedTags });
      }

      if (request.method === 'POST' && path === '/api/feedbacks') {
        const b = await readJsonBody(request);
        const trackingCode = createTrackingCode();
        await client.execute({ sql: `INSERT INTO feedback (tracking_code, place_id, proposed_place_name, feedback_type, details, proposed_payload) VALUES (?, ?, ?, ?, ?, ?)`, args: [trackingCode, b.placeId, b.proposedPlaceName, b.feedbackType, b.details, b.proposedPayload ? JSON.stringify(b.proposedPayload) : null] });
        return sendJson(response, 201, { feedback: { trackingCode, status: '待审核' } });
      }

      if (request.method === 'GET' && path.startsWith('/api/feedbacks/')) {
        const code = decodeURIComponent(path.split('/').pop()).toUpperCase();
        const row = (await client.execute({ sql: 'SELECT * FROM feedback WHERE tracking_code = ?', args: [code] })).rows[0];
        if (!row) return sendJson(response, 404, { error: 'not_found' });
        return sendJson(response, 200, { feedback: mapFeedback(row) });
      }

      // 静态文件服务
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
      if (path === '/' || path === '/index.html') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return response.end(readFileSync(pagePath)); }
      if (path === '/app.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return response.end(readFileSync(scriptPath)); }
      if (path === '/database/seed.json') { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return response.end(readFileSync(seedPath)); }

      if (path.startsWith('/libs/') || path.startsWith('/data/')) {
        const filePath = join(projectRoot, path);
        if (!filePath.startsWith(projectRoot)) return response.end('禁止访问');
        if (existsSync(filePath)) {
          response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' });
          return response.end(readFileSync(filePath));
        }
      }
      response.writeHead(404); response.end('页面不存在');
    } catch (error) {
      console.error('处理请求失败：', error);
      if (!response.headersSent) sendJson(response, 500, { error: 'internal_error', message: error.message });
      else response.end();
    }
  });
}