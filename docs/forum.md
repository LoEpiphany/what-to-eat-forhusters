# 校园论坛

论坛采用服务端持久化模式。帖子、评论、点赞、收藏和举报保存在项目使用的 SQLite/Turso 数据库中，不再只依赖浏览器缓存。

## 已实现功能

- 频道筛选、搜索、最新/热议排序和分页。
- 登录用户发帖、编辑和删除自己的帖子。
- 帖子点赞、收藏和分享。
- 评论发布、评论点赞和删除自己的评论。
- 举报帖子或评论。
- 管理员后台查看、忽略举报或下架被举报内容。
- 服务端 Token 身份校验、软删除和举报审核状态。
- 论坛页面每 30 秒自动刷新服务端数据。
- 桌面与移动端响应式界面。

## 数据库

论坛使用以下表：

- `users`：普通用户账号。
- `forum_posts`：帖子。
- `forum_comments`：评论。
- `forum_post_likes`：帖子点赞关系。
- `forum_post_bookmarks`：帖子收藏关系。
- `forum_comment_likes`：评论点赞关系。
- `forum_reports`：举报与审核记录。

表结构位于 `database/schema.sql`。服务启动时会调用 `database/init.mjs`，自动创建缺失的表；已有地点和反馈数据不会被清空。

首次初始化会创建一个不可登录的论坛系统账号，并写入三条欢迎内容。如果论坛已经有帖子，则不会重复导入欢迎内容。

## 公共 API

```text
GET    /api/forum/posts
POST   /api/forum/posts
GET    /api/forum/posts/:id
PATCH  /api/forum/posts/:id
DELETE /api/forum/posts/:id
POST   /api/forum/posts/:id/like
POST   /api/forum/posts/:id/bookmark
POST   /api/forum/posts/:id/comments
POST   /api/forum/comments/:id/like
DELETE /api/forum/comments/:id
POST   /api/forum/reports
```

写操作需要在请求头中携带普通用户 Token：

```http
Authorization: Bearer <token>
```

论坛列表支持以下查询参数：

```text
category=all|review|partner|ask|campus|market
sort=latest|hot
search=<关键词>
page=1
limit=20
```

## 管理员 API

管理员 Token 需要通过 `POST /api/admin/login` 获取。

```text
GET   /api/admin/forum/reports?status=pending|all
PATCH /api/admin/forum/reports/:id
PATCH /api/admin/forum/posts/:id
PATCH /api/admin/forum/comments/:id
```

举报处理动作：

```json
{ "action": "dismiss" }
{ "action": "hide_target" }
{ "action": "review" }
```

管理员可以在网页的“管理员后台 → 论坛审核”中完成待处理举报的查看、忽略和内容下架。

## 验证

```powershell
npm run check
npm test
```

接口测试使用内存 SQLite，会自动验证鉴权、发帖、评论、点赞、收藏、举报和管理员下架流程。

## 部署提示

论坛依赖 Node 服务处理 API，因此不能只部署静态 `index.html`。Render 或 Zeabur 等平台必须运行：

```powershell
npm start
```

数据库初始化会在服务启动时自动完成。生产环境应配置稳定的数据库地址和 `JWT_SECRET`，并妥善保管管理员密码。

当前版本支持文字论坛。图片上传、通知、私信和更细粒度的禁言管理不属于当前实现范围。
