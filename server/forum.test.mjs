import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.mjs';

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { response, body };
}

async function registerAndLogin(base, username) {
  const password = `password-${username}-123`;
  const registered = await jsonRequest(`${base}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, nickname: `${username}同学` }),
  });
  assert.equal(registered.response.status, 201);
  const login = await jsonRequest(`${base}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.response.status, 200);
  return login.body.token;
}

function auth(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

test('论坛支持服务端发帖、评论、点赞、收藏、举报与管理员下架', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));
  const server = createApp(database, {
    adminUsername: 'forum-admin',
    adminPassword: 'forum-admin-password',
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const anonymousCreate = await jsonRequest(`${base}/api/forum/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'review',
        title: '未登录不应该发帖成功',
        content: '这是一段长度足够的未登录测试正文。',
      }),
    });
    assert.equal(anonymousCreate.response.status, 401);

    const aliceToken = await registerAndLogin(base, 'alice_forum');
    const bobToken = await registerAndLogin(base, 'bob_forum');

    const invalidPost = await jsonRequest(`${base}/api/forum/posts`, {
      method: 'POST',
      headers: auth(aliceToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ category: 'unknown', title: '短', content: '短' }),
    });
    assert.equal(invalidPost.response.status, 400);

    const created = await jsonRequest(`${base}/api/forum/posts`, {
      method: 'POST',
      headers: auth(aliceToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        category: 'review',
        title: '东一食堂晚餐实测记录',
        content: '今天尝试了新的套餐，价格和分量都不错，适合晚课后快速用餐。',
        location: '东一食堂 · 2F',
        tags: ['东一食堂', '晚餐'],
      }),
    });
    assert.equal(created.response.status, 201);
    const postId = created.body.post.id;
    assert.equal(created.body.post.author.name, 'alice_forum同学');
    assert.deepEqual(created.body.post.tags, ['东一食堂', '晚餐']);
    assert.equal(created.body.post.isOwner, true);

    const list = await jsonRequest(`${base}/api/forum/posts?category=review&sort=latest`);
    assert.equal(list.response.status, 200);
    assert.equal(list.body.posts.length, 1);
    assert.equal(list.body.posts[0].commentCount, 0);
    assert.equal(list.body.stats.topics, 1);

    const aliceLike = await jsonRequest(`${base}/api/forum/posts/${postId}/like`, {
      method: 'POST',
      headers: auth(aliceToken),
    });
    assert.equal(aliceLike.response.status, 200);
    assert.equal(aliceLike.body.liked, true);
    assert.equal(aliceLike.body.likes, 1);

    const bobLike = await jsonRequest(`${base}/api/forum/posts/${postId}/like`, {
      method: 'POST',
      headers: auth(bobToken),
    });
    assert.equal(bobLike.body.likes, 2);

    const bookmark = await jsonRequest(`${base}/api/forum/posts/${postId}/bookmark`, {
      method: 'POST',
      headers: auth(aliceToken),
    });
    assert.equal(bookmark.response.status, 200);
    assert.equal(bookmark.body.bookmarked, true);

    const comment = await jsonRequest(`${base}/api/forum/posts/${postId}/comments`, {
      method: 'POST',
      headers: auth(bobToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content: '请问是哪一个窗口？明天也想去试试。' }),
    });
    assert.equal(comment.response.status, 201);
    const commentId = comment.body.comment.id;

    const detail = await jsonRequest(`${base}/api/forum/posts/${postId}`, {
      headers: auth(bobToken),
    });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.post.likes, 2);
    assert.equal(detail.body.post.liked, true);
    assert.equal(detail.body.post.bookmarked, false);
    assert.equal(detail.body.comments.length, 1);
    assert.equal(detail.body.comments[0].isOwner, true);

    const forbiddenDelete = await jsonRequest(`${base}/api/forum/posts/${postId}`, {
      method: 'DELETE',
      headers: auth(bobToken),
    });
    assert.equal(forbiddenDelete.response.status, 403);

    const report = await jsonRequest(`${base}/api/forum/reports`, {
      method: 'POST',
      headers: auth(aliceToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        targetType: 'comment',
        targetId: commentId,
        reason: 'other',
        details: '自动化测试举报记录',
      }),
    });
    assert.equal(report.response.status, 201);

    const adminLogin = await jsonRequest(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'forum-admin', password: 'forum-admin-password' }),
    });
    assert.equal(adminLogin.response.status, 200);
    const adminToken = adminLogin.body.token;

    const reports = await jsonRequest(`${base}/api/admin/forum/reports`, {
      headers: auth(adminToken),
    });
    assert.equal(reports.response.status, 200);
    assert.equal(reports.body.reports.length, 1);
    assert.equal(reports.body.reports[0].target.type, 'comment');

    const hideComment = await jsonRequest(`${base}/api/admin/forum/reports/${reports.body.reports[0].id}`, {
      method: 'PATCH',
      headers: auth(adminToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'hide_target' }),
    });
    assert.equal(hideComment.response.status, 200);

    const hiddenCommentDetail = await jsonRequest(`${base}/api/forum/posts/${postId}`);
    assert.equal(hiddenCommentDetail.body.comments.length, 0);

    const pinPost = await jsonRequest(`${base}/api/admin/forum/posts/${postId}`, {
      method: 'PATCH',
      headers: auth(adminToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pinned: true }),
    });
    assert.equal(pinPost.response.status, 200);

    const ownerDelete = await jsonRequest(`${base}/api/forum/posts/${postId}`, {
      method: 'DELETE',
      headers: auth(aliceToken),
    });
    assert.equal(ownerDelete.response.status, 200);

    const deletedDetail = await jsonRequest(`${base}/api/forum/posts/${postId}`);
    assert.equal(deletedDetail.response.status, 404);

    const tampered = await jsonRequest(`${base}/api/forum/posts`, {
      method: 'POST',
      headers: auth(`${aliceToken}x`, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        category: 'campus',
        title: '篡改令牌不应该成功',
        content: '这是一段用于验证签名校验的测试正文。',
      }),
    });
    assert.equal(tampered.response.status, 401);

    const forumScript = await fetch(`${base}/forum.js`);
    assert.equal(forumScript.status, 200);
    assert.match(forumScript.headers.get('content-type'), /javascript/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    database.close();
  }
});
