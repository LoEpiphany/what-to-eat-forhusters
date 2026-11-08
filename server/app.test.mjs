import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.mjs';

test('地点列表和详情从 SQLite 返回，缺失地点返回 404', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));
  database.prepare(`
    INSERT INTO places
      (id, name, place_type, source_group, source_label, map_x, map_y,
       longitude, latitude, coordinate_source, location_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('canteen-demo', '示例食堂', 'canteen', '食堂', '示例食堂', 42, 58,
    114.4, 30.5, '测试坐标', '大致位置');
  database.prepare(`
    INSERT INTO recommendations (id, place_id, name, floor, source_label, meal_period, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('rec-demo', 'canteen-demo', '牛肉面', 2, '二楼牛肉面', 'breakfast', '已核实');

  const server = createApp(database, { adminUsername: 'reviewer', adminPassword: 'test-password-123' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const list = await fetch(`${base}/api/places`);
    assert.equal(list.status, 200);
    const data = await list.json();
    assert.equal(data.places.length, 1);
    assert.equal(data.places[0].recommendations[0].name, '牛肉面');
    assert.equal(data.places[0].recommendations[0].floor, 2);
    assert.equal(data.places[0].recommendations[0].mealPeriod, 'breakfast');
    assert.equal(data.places[0].recommendations[0].verificationStatus, '已确认');
    assert.equal(data.places[0].mapX, 42);
    assert.equal(data.places[0].longitude, 114.4);
    assert.equal(data.places[0].coordinateSource, '测试坐标');
    assert.equal(data.places[0].locationStatus, '大致位置');

    const detail = await fetch(`${base}/api/places/canteen-demo`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).place.name, '示例食堂');

    const missing = await fetch(`${base}/api/places/unknown`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'place_not_found');

    const invalid = await fetch(`${base}/api/places/%ZZ`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'invalid_id');

    const feedbackResponse = await fetch(`${base}/api/feedbacks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: 'canteen-demo',
        feedbackType: '位置有误',
        details: '入口已经调整，请重新核对地图位置。',
        proposedPayload: { latitude: 30.51, longitude: 114.41 },
      }),
    });
    assert.equal(feedbackResponse.status, 201);
    const feedback = (await feedbackResponse.json()).feedback;
    assert.match(feedback.trackingCode, /^FB-\d{8}-[A-F0-9]{6}$/);
    assert.equal(feedback.status, '待审核');

    const feedbackStatus = await fetch(`${base}/api/feedbacks/${feedback.trackingCode}`);
    assert.equal(feedbackStatus.status, 200);
    assert.equal((await feedbackStatus.json()).feedback.feedbackType, '位置有误');

    const blockedReview = await fetch(`${base}/api/admin/feedbacks`);
    assert.equal(blockedReview.status, 401);

    const badLogin = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reviewer', password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);

    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reviewer', password: 'test-password-123' }),
    });
    assert.equal(login.status, 200);
    const token = (await login.json()).token;

    const reviewList = await fetch(`${base}/api/admin/feedbacks`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(reviewList.status, 200);
    assert.equal((await reviewList.json()).feedbacks.length, 1);

    const decision = await fetch(`${base}/api/admin/feedbacks/${feedback.trackingCode}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ decision: 'approve', reviewNote: '已核对现场信息，采纳修改。' }),
    });
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).feedback.status, '已批准');

    const reviewedStatus = await fetch(`${base}/api/feedbacks/${feedback.trackingCode}`);
    assert.equal((await reviewedStatus.json()).feedback.reviewNote, '已核对现场信息，采纳修改。');

    const missingFeedback = await fetch(`${base}/api/feedbacks/FB-20000101-000000`);
    assert.equal(missingFeedback.status, 404);

    const invalidFeedback = await fetch(`${base}/api/feedbacks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: 'canteen-demo', feedbackType: '未知类型', details: '测试' }),
    });
    assert.equal(invalidFeedback.status, 400);

    const write = await fetch(`${base}/api/places`, { method: 'POST' });
    assert.equal(write.status, 405);

    const health = await fetch(`${base}/api/health`);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /华科觅食/);

    const script = await fetch(`${base}/app.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /loadPlaces\(\)/);

    const seed = await fetch(`${base}/database/seed.json`);
    assert.equal(seed.status, 200);
    assert.ok((await seed.json()).places.length > 0);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    database.close();
  }
});
