import { randomBytes } from 'node:crypto';
import { FORUM_INDEX_SQL, FORUM_SCHEMA_SQL } from './forum-schema.mjs';

const FORUM_CATEGORIES = new Set(['review', 'partner', 'ask', 'campus', 'market']);
const REPORT_REASONS = new Set(['spam', 'harassment', 'misinformation', 'privacy', 'other']);
const POST_STATUSES = new Set(['published', 'hidden']);
const COMMENT_STATUSES = new Set(['published', 'hidden']);

const POST_SELECT = `
  SELECT
    p.id, p.user_id, p.category, p.title, p.content, p.location, p.tags,
    p.status, p.pinned, p.created_at, p.updated_at,
    COALESCE(NULLIF(u.nickname, ''), u.username, '校园同学') AS author_name,
    u.username AS author_username,
    (SELECT COUNT(*) FROM forum_post_likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM forum_comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count,
    (SELECT COUNT(*) FROM forum_post_bookmarks b WHERE b.post_id = p.id) AS bookmark_count,
    CASE WHEN ? <> '' AND EXISTS (
      SELECT 1 FROM forum_post_likes l WHERE l.post_id = p.id AND l.user_id = ?
    ) THEN 1 ELSE 0 END AS liked,
    CASE WHEN ? <> '' AND EXISTS (
      SELECT 1 FROM forum_post_bookmarks b WHERE b.post_id = p.id AND b.user_id = ?
    ) THEN 1 ELSE 0 END AS bookmarked
  FROM forum_posts p
  JOIN users u ON u.id = p.user_id
`;

const COMMENT_SELECT = `
  SELECT
    c.id, c.post_id, c.user_id, c.content, c.status, c.created_at, c.updated_at,
    COALESCE(NULLIF(u.nickname, ''), u.username, '校园同学') AS author_name,
    u.username AS author_username,
    (SELECT COUNT(*) FROM forum_comment_likes l WHERE l.comment_id = c.id) AS like_count,
    CASE WHEN ? <> '' AND EXISTS (
      SELECT 1 FROM forum_comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?
    ) THEN 1 ELSE 0 END AS liked
  FROM forum_comments c
  JOIN users u ON u.id = c.user_id
`;

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}

function parseTags(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,，]/);
  const seen = new Set();
  return raw
    .map(tag => String(tag || '').trim().replace(/^#/, ''))
    .filter(tag => {
      if (!tag || tag.length > 20 || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 5);
}

function tagsFromRow(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapForumPost(row, viewerId = '') {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    location: row.location || '',
    tags: tagsFromRow(row.tags),
    status: row.status,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    likes: Number(row.like_count) || 0,
    commentCount: Number(row.comment_count) || 0,
    bookmarkCount: Number(row.bookmark_count) || 0,
    liked: Boolean(row.liked),
    bookmarked: Boolean(row.bookmarked),
    isOwner: Boolean(viewerId && row.user_id === viewerId),
    author: {
      id: row.user_id,
      name: row.author_name || row.author_username || '校园同学',
      level: '校园社区成员',
    },
  };
}

function mapForumComment(row, viewerId = '', isAdmin = false) {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    likes: Number(row.like_count) || 0,
    liked: Boolean(row.liked),
    isOwner: Boolean(viewerId && row.user_id === viewerId),
    canModerate: isAdmin,
    author: {
      id: row.user_id,
      name: row.author_name || row.author_username || '校园同学',
    },
  };
}

function validatePost(body) {
  const category = String(body.category || '');
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const location = String(body.location || '').trim().slice(0, 80);
  if (!FORUM_CATEGORIES.has(category)) return { error: '请选择有效的论坛频道' };
  if (title.length < 4 || title.length > 80) return { error: '标题长度需要在 4 到 80 个字符之间' };
  if (content.length < 10 || content.length > 3000) return { error: '正文长度需要在 10 到 3000 个字符之间' };
  return { value: { category, title, content, location, tags: parseTags(body.tags) } };
}

function decodeId(raw) {
  try {
    const value = decodeURIComponent(raw || '');
    return value && value.length <= 100 ? value : null;
  } catch {
    return null;
  }
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function mapReport(row) {
  return {
    id: row.id,
    reason: row.reason,
    details: row.details || '',
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by || '',
    reporter: {
      id: row.reporter_id,
      name: row.reporter_name,
    },
    target: row.post_id
      ? { type: 'post', id: row.post_id, title: row.post_title, content: row.post_content, status: row.post_status }
      : { type: 'comment', id: row.comment_id, title: '帖子评论', content: row.comment_content, status: row.comment_status },
  };
}

export function createForumApi({ client, sessionFor, readJsonBody, sendJson }) {
  let schemaReady = false;
  let schemaPromise = null;

  async function ensureSchema() {
    if (schemaReady) return;
    if (!schemaPromise) {
      schemaPromise = (async () => {
        if (typeof client.executeMultiple !== 'function') {
          throw new Error('数据库客户端不支持论坛自动迁移');
        }
        await client.executeMultiple(FORUM_SCHEMA_SQL);
        const postColumns = await client.execute('PRAGMA table_info(forum_posts)');
        if (!postColumns.rows.some(column => column.name === 'status')) {
          await client.execute("ALTER TABLE forum_posts ADD COLUMN status TEXT NOT NULL DEFAULT 'published'");
        }
        const commentColumns = await client.execute('PRAGMA table_info(forum_comments)');
        if (!commentColumns.rows.some(column => column.name === 'status')) {
          await client.execute("ALTER TABLE forum_comments ADD COLUMN status TEXT NOT NULL DEFAULT 'published'");
        }
        if (!commentColumns.rows.some(column => column.name === 'updated_at')) {
          await client.execute('ALTER TABLE forum_comments ADD COLUMN updated_at TEXT');
          await client.execute('UPDATE forum_comments SET updated_at = created_at WHERE updated_at IS NULL');
        }
        await client.executeMultiple(FORUM_INDEX_SQL);
        schemaReady = true;
      })().catch(error => {
        schemaPromise = null;
        throw error;
      });
    }
    await schemaPromise;
  }

  function viewerFor(request) {
    const session = sessionFor(request);
    return {
      session,
      viewerId: session?.userId || '',
      isAdmin: session?.role === 'admin',
    };
  }

  function requireUser(request, response) {
    const viewer = viewerFor(request);
    if (!viewer.session) {
      sendJson(response, 401, { error: 'unauthorized', message: '请先登录后再参与论坛互动' });
      return null;
    }
    if (!viewer.viewerId) {
      sendJson(response, 403, { error: 'user_account_required', message: '管理员请使用普通用户账号参与发帖和评论' });
      return null;
    }
    return viewer;
  }

  function requireAdmin(request, response) {
    const session = sessionFor(request);
    if (!session) {
      sendJson(response, 401, { error: 'unauthorized', message: '请先以管理员身份登录' });
      return null;
    }
    if (session.role !== 'admin') {
      sendJson(response, 403, { error: 'forbidden', message: '需要管理员权限' });
      return null;
    }
    return session;
  }

  async function getPost(id, viewerId = '') {
    const result = await client.execute({
      sql: `${POST_SELECT} WHERE p.id = ? AND p.status = 'published'`,
      args: [viewerId, viewerId, viewerId, viewerId, id],
    });
    return result.rows[0] ? mapForumPost(result.rows[0], viewerId) : null;
  }

  async function listPosts(request, response, url) {
    const viewer = viewerFor(request);
    const category = url.searchParams.get('category') || 'all';
    if (category !== 'all' && !FORUM_CATEGORIES.has(category)) {
      return sendJson(response, 400, { error: 'invalid_category', message: '论坛频道不存在' });
    }
    const search = String(url.searchParams.get('search') || '').trim().slice(0, 80);
    const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'latest';
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20));
    const offset = (page - 1) * limit;

    const where = ["p.status = 'published'"];
    const args = [];
    if (category !== 'all') {
      where.push('p.category = ?');
      args.push(category);
    }
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      where.push(`(
        p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\'
        OR p.tags LIKE ? ESCAPE '\\' OR u.nickname LIKE ? ESCAPE '\\'
        OR u.username LIKE ? ESCAPE '\\'
      )`);
      args.push(pattern, pattern, pattern, pattern, pattern);
    }
    const whereSql = where.join(' AND ');
    const orderSql = sort === 'hot'
      ? `p.pinned DESC,
         ((SELECT COUNT(*) FROM forum_post_likes l WHERE l.post_id = p.id) * 2
          + (SELECT COUNT(*) FROM forum_comments c WHERE c.post_id = p.id AND c.status = 'published') * 4
          + (SELECT COUNT(*) FROM forum_post_bookmarks b WHERE b.post_id = p.id)) DESC,
         p.created_at DESC`
      : 'p.pinned DESC, p.created_at DESC';

    const list = await client.execute({
      sql: `${POST_SELECT} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
      args: [viewer.viewerId, viewer.viewerId, viewer.viewerId, viewer.viewerId, ...args, limit, offset],
    });
    const count = await client.execute({
      sql: `SELECT COUNT(*) AS count
            FROM forum_posts p JOIN users u ON u.id = p.user_id
            WHERE ${whereSql}`,
      args,
    });
    const stats = await client.execute(`
      SELECT
        (SELECT COUNT(*) FROM forum_posts WHERE status = 'published') AS topic_count,
        (SELECT COUNT(*) FROM forum_comments c
          JOIN forum_posts p ON p.id = c.post_id
          WHERE c.status = 'published' AND p.status = 'published') AS reply_count,
        (SELECT COUNT(DISTINCT user_id) FROM (
          SELECT user_id FROM forum_posts WHERE status = 'published'
          UNION ALL
          SELECT c.user_id FROM forum_comments c
          JOIN forum_posts p ON p.id = c.post_id
          WHERE c.status = 'published' AND p.status = 'published'
        )) AS member_count
    `);
    const categoryStats = await client.execute(`
      SELECT category, COUNT(*) AS count
      FROM forum_posts
      WHERE status = 'published'
      GROUP BY category
    `);
    const statRow = stats.rows[0] || {};
    const total = Number(count.rows[0]?.count) || 0;
    const categories = Object.fromEntries(categoryStats.rows.map(row => [row.category, Number(row.count) || 0]));
    return sendJson(response, 200, {
      posts: list.rows.map(row => mapForumPost(row, viewer.viewerId)),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      stats: {
        topics: Number(statRow.topic_count) || 0,
        replies: Number(statRow.reply_count) || 0,
        members: Number(statRow.member_count) || 0,
        categories: { all: Number(statRow.topic_count) || 0, ...categories },
      },
    });
  }

  async function getPostDetail(request, response, postId) {
    const viewer = viewerFor(request);
    const post = await getPost(postId, viewer.viewerId);
    if (!post) return sendJson(response, 404, { error: 'post_not_found', message: '帖子不存在或已下架' });
    const comments = await client.execute({
      sql: `${COMMENT_SELECT}
            WHERE c.post_id = ? AND c.status = 'published'
            ORDER BY c.created_at ASC`,
      args: [viewer.viewerId, viewer.viewerId, postId],
    });
    return sendJson(response, 200, {
      post: { ...post, canModerate: viewer.isAdmin },
      comments: comments.rows.map(row => mapForumComment(row, viewer.viewerId, viewer.isAdmin)),
    });
  }

  async function createPost(request, response) {
    const viewer = requireUser(request, response);
    if (!viewer) return;
    const body = await readJsonBody(request, 16 * 1024);
    const validated = validatePost(body);
    if (validated.error) return sendJson(response, 400, { error: 'invalid_post', message: validated.error });
    const data = validated.value;
    const id = createId('post');
    await client.execute({
      sql: `INSERT INTO forum_posts
            (id, user_id, category, title, content, location, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, viewer.viewerId, data.category, data.title, data.content, data.location || null, JSON.stringify(data.tags)],
    });
    return sendJson(response, 201, { post: await getPost(id, viewer.viewerId) });
  }

  async function updatePost(request, response, postId) {
    const viewer = viewerFor(request);
    if (!viewer.session) return sendJson(response, 401, { error: 'unauthorized', message: '请先登录' });
    const existing = (await client.execute({
      sql: 'SELECT user_id, status FROM forum_posts WHERE id = ?',
      args: [postId],
    })).rows[0];
    if (!existing || existing.status === 'deleted') {
      return sendJson(response, 404, { error: 'post_not_found', message: '帖子不存在' });
    }
    if (!viewer.isAdmin && existing.user_id !== viewer.viewerId) {
      return sendJson(response, 403, { error: 'forbidden', message: '只能编辑自己发布的帖子' });
    }
    const body = await readJsonBody(request, 16 * 1024);
    const validated = validatePost(body);
    if (validated.error) return sendJson(response, 400, { error: 'invalid_post', message: validated.error });
    const data = validated.value;
    await client.execute({
      sql: `UPDATE forum_posts
            SET category = ?, title = ?, content = ?, location = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [data.category, data.title, data.content, data.location || null, JSON.stringify(data.tags), postId],
    });
    return sendJson(response, 200, { post: await getPost(postId, viewer.viewerId) });
  }

  async function deletePost(request, response, postId) {
    const viewer = viewerFor(request);
    if (!viewer.session) return sendJson(response, 401, { error: 'unauthorized', message: '请先登录' });
    const existing = (await client.execute({
      sql: 'SELECT user_id FROM forum_posts WHERE id = ? AND status <> \'deleted\'',
      args: [postId],
    })).rows[0];
    if (!existing) return sendJson(response, 404, { error: 'post_not_found', message: '帖子不存在' });
    if (!viewer.isAdmin && existing.user_id !== viewer.viewerId) {
      return sendJson(response, 403, { error: 'forbidden', message: '只能删除自己发布的帖子' });
    }
    await client.execute({
      sql: `UPDATE forum_posts SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [postId],
    });
    return sendJson(response, 200, { ok: true });
  }

  async function togglePostLike(request, response, postId) {
    const viewer = requireUser(request, response);
    if (!viewer) return;
    const post = (await client.execute({
      sql: `SELECT id FROM forum_posts WHERE id = ? AND status = 'published'`,
      args: [postId],
    })).rows[0];
    if (!post) return sendJson(response, 404, { error: 'post_not_found', message: '帖子不存在或已下架' });
    const existing = (await client.execute({
      sql: 'SELECT 1 AS found FROM forum_post_likes WHERE post_id = ? AND user_id = ?',
      args: [postId, viewer.viewerId],
    })).rows[0];
    if (existing) {
      await client.execute({ sql: 'DELETE FROM forum_post_likes WHERE post_id = ? AND user_id = ?', args: [postId, viewer.viewerId] });
    } else {
      await client.execute({ sql: 'INSERT INTO forum_post_likes (post_id, user_id) VALUES (?, ?)', args: [postId, viewer.viewerId] });
    }
    const count = (await client.execute({ sql: 'SELECT COUNT(*) AS count FROM forum_post_likes WHERE post_id = ?', args: [postId] })).rows[0];
    return sendJson(response, 200, { liked: !existing, likes: Number(count.count) || 0 });
  }

  async function togglePostBookmark(request, response, postId) {
    const viewer = requireUser(request, response);
    if (!viewer) return;
    const post = (await client.execute({
      sql: `SELECT id FROM forum_posts WHERE id = ? AND status = 'published'`,
      args: [postId],
    })).rows[0];
    if (!post) return sendJson(response, 404, { error: 'post_not_found', message: '帖子不存在或已下架' });
    const existing = (await client.execute({
      sql: 'SELECT 1 AS found FROM forum_post_bookmarks WHERE post_id = ? AND user_id = ?',
      args: [postId, viewer.viewerId],
    })).rows[0];
    if (existing) {
      await client.execute({ sql: 'DELETE FROM forum_post_bookmarks WHERE post_id = ? AND user_id = ?', args: [postId, viewer.viewerId] });
    } else {
      await client.execute({ sql: 'INSERT INTO forum_post_bookmarks (post_id, user_id) VALUES (?, ?)', args: [postId, viewer.viewerId] });
    }
    const count = (await client.execute({ sql: 'SELECT COUNT(*) AS count FROM forum_post_bookmarks WHERE post_id = ?', args: [postId] })).rows[0];
    return sendJson(response, 200, { bookmarked: !existing, bookmarks: Number(count.count) || 0 });
  }

  async function createComment(request, response, postId) {
    const viewer = requireUser(request, response);
    if (!viewer) return;
    const post = (await client.execute({
      sql: `SELECT id FROM forum_posts WHERE id = ? AND status = 'published'`,
      args: [postId],
    })).rows[0];
    if (!post) return sendJson(response, 404, { error: 'post_not_found', message: '帖子不存在或已下架' });
    const body = await readJsonBody(request, 8 * 1024);
    const content = String(body.content || '').trim();
    if (content.length < 1 || content.length > 1000) {
      return sendJson(response, 400, { error: 'invalid_comment', message: '评论长度需要在 1 到 1000 个字符之间' });
    }
    const id = createId('comment');
    await client.execute({
      sql: 'INSERT INTO forum_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)',
      args: [id, postId, viewer.viewerId, content],
    });
    const comment = (await client.execute({
      sql: `${COMMENT_SELECT} WHERE c.id = ?`,
      args: [viewer.viewerId, viewer.viewerId, id],
    })).rows[0];
    return sendJson(response, 201, { comment: mapForumComment(comment, viewer.viewerId) });
  }

  async function deleteComment(request, response, commentId) {
    const viewer = viewerFor(request);
    if (!viewer.session) return sendJson(response, 401, { error: 'unauthorized', message: '请先登录' });
    const existing = (await client.execute({
      sql: 'SELECT user_id FROM forum_comments WHERE id = ? AND status <> \'deleted\'',
      args: [commentId],
    })).rows[0];
    if (!existing) return sendJson(response, 404, { error: 'comment_not_found', message: '评论不存在' });
    if (!viewer.isAdmin && existing.user_id !== viewer.viewerId) {
      return sendJson(response, 403, { error: 'forbidden', message: '只能删除自己的评论' });
    }
    await client.execute({
      sql: `UPDATE forum_comments SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [commentId],
    });
    return sendJson(response, 200, { ok: true });
  }

  async function toggleCommentLike(request, response, commentId) {
    const viewer = requireUser(request, response);
    if (!viewer) return;
    const comment = (await client.execute({
      sql: `SELECT id FROM forum_comments WHERE id = ? AND status = 'published'`,
      args: [commentId],
    })).rows[0];
    if (!comment) return sendJson(response, 404, { error: 'comment_not_found', message: '评论不存在或已下架' });
    const existing = (await client.execute({
      sql: 'SELECT 1 AS found FROM forum_comment_likes WHERE comment_id = ? AND user_id = ?',
      args: [commentId, viewer.viewerId],
    })).rows[0];
    if (existing) {
      await client.execute({ sql: 'DELETE FROM forum_comment_likes WHERE comment_id = ? AND user_id = ?', args: [commentId, viewer.viewerId] });
    } else {
      await client.execute({ sql: 'INSERT INTO forum_comment_likes (comment_id, user_id) VALUES (?, ?)', args: [commentId, viewer.viewerId] });
    }
    const count = (await client.execute({ sql: 'SELECT COUNT(*) AS count FROM forum_comment_likes WHERE comment_id = ?', args: [commentId] })).rows[0];
    return sendJson(response, 200, { liked: !existing, likes: Number(count.count) || 0 });
  }

  async function createReport(request, response) {
    const viewer = requireUser(request, response);
    if (!viewer) return;
    const body = await readJsonBody(request, 8 * 1024);
    const targetType = body.targetType;
    const targetId = String(body.targetId || '');
    const reason = String(body.reason || '');
    const details = String(body.details || '').trim().slice(0, 500);
    if (!['post', 'comment'].includes(targetType) || !targetId) {
      return sendJson(response, 400, { error: 'invalid_target', message: '举报对象无效' });
    }
    if (!REPORT_REASONS.has(reason)) {
      return sendJson(response, 400, { error: 'invalid_reason', message: '请选择有效的举报原因' });
    }
    const table = targetType === 'post' ? 'forum_posts' : 'forum_comments';
    const target = (await client.execute({
      sql: `SELECT id FROM ${table} WHERE id = ? AND status = 'published'`,
      args: [targetId],
    })).rows[0];
    if (!target) return sendJson(response, 404, { error: 'target_not_found', message: '举报对象不存在或已下架' });
    const id = createId('report');
    await client.execute({
      sql: `INSERT INTO forum_reports (id, post_id, comment_id, reporter_id, reason, details)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        targetType === 'post' ? targetId : null,
        targetType === 'comment' ? targetId : null,
        viewer.viewerId,
        reason,
        details || null,
      ],
    });
    return sendJson(response, 201, { report: { id, status: 'pending' } });
  }

  async function adminReports(request, response, url) {
    if (!requireAdmin(request, response)) return;
    const status = url.searchParams.get('status') === 'all' ? 'all' : 'pending';
    const result = await client.execute({
      sql: `SELECT
              r.*, COALESCE(NULLIF(u.nickname, ''), u.username, '校园同学') AS reporter_name,
              p.title AS post_title, p.content AS post_content, p.status AS post_status,
              c.content AS comment_content, c.status AS comment_status
            FROM forum_reports r
            JOIN users u ON u.id = r.reporter_id
            LEFT JOIN forum_posts p ON p.id = r.post_id
            LEFT JOIN forum_comments c ON c.id = r.comment_id
            WHERE (? = 'all' OR r.status = 'pending')
            ORDER BY r.created_at DESC`,
      args: [status],
    });
    return sendJson(response, 200, { reports: result.rows.map(mapReport) });
  }

  async function adminUpdateReport(request, response, reportId) {
    const admin = requireAdmin(request, response);
    if (!admin) return;
    const report = (await client.execute({
      sql: 'SELECT * FROM forum_reports WHERE id = ?',
      args: [reportId],
    })).rows[0];
    if (!report) return sendJson(response, 404, { error: 'report_not_found', message: '举报记录不存在' });
    const body = await readJsonBody(request, 8 * 1024);
    const action = body.action;
    if (!['dismiss', 'hide_target', 'review'].includes(action)) {
      return sendJson(response, 400, { error: 'invalid_action', message: '举报处理动作无效' });
    }
    if (action === 'hide_target') {
      const table = report.post_id ? 'forum_posts' : 'forum_comments';
      const column = report.post_id ? 'post_id' : 'comment_id';
      const targetId = report.post_id || report.comment_id;
      await client.execute({
        sql: `UPDATE ${table} SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [targetId],
      });
      await client.execute({
        sql: `UPDATE forum_reports SET status = 'reviewed', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
              WHERE ${column} = ? AND status = 'pending'`,
        args: [admin.username || 'admin', targetId],
      });
    } else {
      await client.execute({
        sql: `UPDATE forum_reports SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?`,
        args: [action === 'dismiss' ? 'dismissed' : 'reviewed', admin.username || 'admin', reportId],
      });
    }
    return sendJson(response, 200, { ok: true });
  }

  async function adminUpdatePost(request, response, postId) {
    if (!requireAdmin(request, response)) return;
    const body = await readJsonBody(request, 4 * 1024);
    const status = body.status === undefined ? null : String(body.status);
    const pinned = body.pinned === undefined ? null : (body.pinned ? 1 : 0);
    if (status !== null && !POST_STATUSES.has(status)) {
      return sendJson(response, 400, { error: 'invalid_status', message: '帖子状态无效' });
    }
    if (status === null && pinned === null) {
      return sendJson(response, 400, { error: 'empty_update', message: '没有可更新的字段' });
    }
    const fields = [];
    const args = [];
    if (status !== null) {
      fields.push('status = ?');
      args.push(status);
    }
    if (pinned !== null) {
      fields.push('pinned = ?');
      args.push(pinned);
    }
    fields.push('updated_at = CURRENT_TIMESTAMP');
    args.push(postId);
    const result = await client.execute({
      sql: `UPDATE forum_posts SET ${fields.join(', ')} WHERE id = ?`,
      args,
    });
    if (!result.rowsAffected) return sendJson(response, 404, { error: 'post_not_found', message: '帖子不存在' });
    return sendJson(response, 200, { ok: true });
  }

  async function adminUpdateComment(request, response, commentId) {
    if (!requireAdmin(request, response)) return;
    const body = await readJsonBody(request, 4 * 1024);
    const status = String(body.status || '');
    if (!COMMENT_STATUSES.has(status)) {
      return sendJson(response, 400, { error: 'invalid_status', message: '评论状态无效' });
    }
    const result = await client.execute({
      sql: 'UPDATE forum_comments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [status, commentId],
    });
    if (!result.rowsAffected) return sendJson(response, 404, { error: 'comment_not_found', message: '评论不存在' });
    return sendJson(response, 200, { ok: true });
  }

  async function handle(request, response, url) {
    await ensureSchema();
    const { pathname: path } = url;
    if (path === '/api/forum/posts') {
      if (request.method === 'GET') return listPosts(request, response, url);
      if (request.method === 'POST') return createPost(request, response);
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }

    let match = path.match(/^\/api\/forum\/posts\/([^/]+)$/);
    if (match) {
      const postId = decodeId(match[1]);
      if (!postId) return sendJson(response, 400, { error: 'invalid_id' });
      if (request.method === 'GET') return getPostDetail(request, response, postId);
      if (request.method === 'PATCH') return updatePost(request, response, postId);
      if (request.method === 'DELETE') return deletePost(request, response, postId);
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }

    match = path.match(/^\/api\/forum\/posts\/([^/]+)\/(like|bookmark|comments)$/);
    if (match) {
      const postId = decodeId(match[1]);
      if (!postId) return sendJson(response, 400, { error: 'invalid_id' });
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });
      if (match[2] === 'like') return togglePostLike(request, response, postId);
      if (match[2] === 'bookmark') return togglePostBookmark(request, response, postId);
      return createComment(request, response, postId);
    }

    match = path.match(/^\/api\/forum\/comments\/([^/]+)(?:\/(like))?$/);
    if (match) {
      const commentId = decodeId(match[1]);
      if (!commentId) return sendJson(response, 400, { error: 'invalid_id' });
      if (match[2]) {
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });
        return toggleCommentLike(request, response, commentId);
      }
      if (request.method === 'DELETE') return deleteComment(request, response, commentId);
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }

    if (path === '/api/forum/reports') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });
      return createReport(request, response);
    }

    if (path === '/api/admin/forum/reports') {
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
      return adminReports(request, response, url);
    }

    match = path.match(/^\/api\/admin\/forum\/reports\/([^/]+)$/);
    if (match) {
      const reportId = decodeId(match[1]);
      if (!reportId) return sendJson(response, 400, { error: 'invalid_id' });
      if (request.method !== 'PATCH') return sendJson(response, 405, { error: 'method_not_allowed' });
      return adminUpdateReport(request, response, reportId);
    }

    match = path.match(/^\/api\/admin\/forum\/posts\/([^/]+)$/);
    if (match) {
      const postId = decodeId(match[1]);
      if (!postId) return sendJson(response, 400, { error: 'invalid_id' });
      if (request.method !== 'PATCH') return sendJson(response, 405, { error: 'method_not_allowed' });
      return adminUpdatePost(request, response, postId);
    }

    match = path.match(/^\/api\/admin\/forum\/comments\/([^/]+)$/);
    if (match) {
      const commentId = decodeId(match[1]);
      if (!commentId) return sendJson(response, 400, { error: 'invalid_id' });
      if (request.method !== 'PATCH') return sendJson(response, 405, { error: 'method_not_allowed' });
      return adminUpdateComment(request, response, commentId);
    }

    return false;
  }

  return { handle };
}
