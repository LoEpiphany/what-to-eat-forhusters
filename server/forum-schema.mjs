// Keep this bundled with the EdgeOne function. Runtime file reads are not
// guaranteed to include database/schema.sql in serverless deployments.
export const FORUM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forum_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('review', 'partner', 'ask', 'campus', 'market')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 4 AND 80),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 10 AND 3000),
  location TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'deleted')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forum_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forum_post_likes (
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_post_bookmarks (
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_comment_likes (
  comment_id TEXT NOT NULL REFERENCES forum_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_post_images (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  data_url TEXT NOT NULL,
  alt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forum_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT REFERENCES forum_posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES forum_comments(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'misinformation', 'privacy', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT,
  CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL))
);

`;

export const FORUM_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS forum_posts_feed
  ON forum_posts (status, category, pinned, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_posts_user
  ON forum_posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_comments_post
  ON forum_comments (post_id, status, created_at);
CREATE INDEX IF NOT EXISTS forum_comments_user
  ON forum_comments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_post_images_post
  ON forum_post_images (post_id, sort_order);
CREATE INDEX IF NOT EXISTS forum_post_likes_user
  ON forum_post_likes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_post_bookmarks_user
  ON forum_post_bookmarks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_reports_status
  ON forum_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_reports_post
  ON forum_reports (post_id);
CREATE INDEX IF NOT EXISTS forum_reports_comment
  ON forum_reports (comment_id);
`;
