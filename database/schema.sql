PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    place_type TEXT NOT NULL CHECK (place_type IN ('canteen', 'shop', 'food_court', 'stall')),
    source_group TEXT NOT NULL CHECK (source_group IN ('食堂', '校内', '校外', '外卖')),
    parent_id TEXT REFERENCES places(id),
    campus_area TEXT CHECK (campus_area IN ('east', 'central', 'west', 'out', 'takeout')),
    location_note TEXT,
    map_x REAL CHECK (map_x IS NULL OR (map_x >= 0 AND map_x <= 100)),
    map_y REAL CHECK (map_y IS NULL OR (map_y >= 0 AND map_y <= 100)),
    longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
    latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
    coordinate_source TEXT,
    location_status TEXT NOT NULL DEFAULT '未定位'
        CHECK (location_status IN ('未定位', '大致位置', '已确认')),
    source_label TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT '待确认'
        CHECK (verification_status IN ('待确认', '已核实')),
    last_confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS places_name_within_parent
    ON places (COALESCE(parent_id, ''), name);
CREATE INDEX IF NOT EXISTS places_parent_id ON places (parent_id);
CREATE INDEX IF NOT EXISTS places_type ON places (place_type);

CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    floor INTEGER CHECK (floor IS NULL OR floor BETWEEN 1 AND 99),
    note TEXT,
    shop TEXT,
    meal_period TEXT CHECK (meal_period IN ('breakfast', 'lunch', 'dinner', 'both', 'all_day')),
    rating REAL DEFAULT 3.0,
    rating_count INTEGER DEFAULT 0,
    tags TEXT,
    source_label TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT '待确认'
        CHECK (verification_status IN ('待确认', '已核实')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS recommendations_place_id ON recommendations (place_id);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_code TEXT UNIQUE,
    place_id TEXT REFERENCES places(id),
    proposed_place_name TEXT,
    feedback_type TEXT NOT NULL CHECK (feedback_type IN (
        '还在这里', '位置有误', '名称有误', '楼层入口错误', '菜品信息有误', '营业时间有误',
        '暂停营业', '新增位置', '其他'
    )),
    details TEXT NOT NULL CHECK (length(trim(details)) > 0),
    proposed_payload TEXT,
    review_status TEXT NOT NULL DEFAULT '待审核'
        CHECK (review_status IN ('待审核', '已批准', '已驳回')),
    review_note TEXT,
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    CHECK (place_id IS NOT NULL OR proposed_place_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS feedback_review_status ON feedback (review_status);

-- ===== 校园论坛 =====
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

CREATE INDEX IF NOT EXISTS forum_posts_feed
    ON forum_posts (status, category, pinned, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_posts_user
    ON forum_posts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 1000),
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'deleted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS forum_comments_post
    ON forum_comments (post_id, status, created_at);
CREATE INDEX IF NOT EXISTS forum_comments_user
    ON forum_comments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_post_likes (
    post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS forum_post_likes_user
    ON forum_post_likes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_post_bookmarks (
    post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS forum_post_bookmarks_user
    ON forum_post_bookmarks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_comment_likes (
    comment_id TEXT NOT NULL REFERENCES forum_comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id, user_id)
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

CREATE INDEX IF NOT EXISTS forum_reports_status
    ON forum_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_reports_post
    ON forum_reports (post_id);
CREATE INDEX IF NOT EXISTS forum_reports_comment
    ON forum_reports (comment_id);
