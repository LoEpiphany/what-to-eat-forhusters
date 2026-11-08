# 地图与位置数据

## 当前实现

首页地图使用 Leaflet 1.9.4 和 OpenStreetMap 在线瓦片，按 WGS84 经纬度显示华中科技大学主校区餐饮点。页面支持缩放、拖动、地点搜索、食堂／店铺筛选、标记弹窗和详情跳转。

相关文件：

- `index.html`：地图容器、工具栏、图例、校准面板和样式。
- `app.js`：Leaflet 初始化、标记分组、筛选、详情联动和浏览器校准草稿。
- `database/seed.json`：静态部署使用的地点、坐标和来源。
- `database/schema.sql`：SQLite 中的位置字段与状态约束。

GitHub Pages 无法运行 Node.js，线上静态页面直接读取 `database/seed.json`；本地服务则优先读取 `/api/places`。

## 坐标与标记

- `longitude`、`latitude`：当前地图使用的 WGS84 经纬度。
- `coordinateSource`：坐标依据，例如官方图层或用户地图标记。
- `locationStatus`：`未定位`、`大致位置`、`已确认`。
- `mapX`、`mapY`：旧版形象化地图使用的 0～100 相对坐标，只为兼容保留。

前端会把相同坐标的多个地点合并成一个标记。例如同一建筑内的窗口或菘邻里的子店铺会共享标记，并在弹窗中分别提供详情入口。

## 位置状态规则

### 已确认

只有满足以下任一条件时才应使用：

- 来自可靠的华科官方地图图层；
- 项目维护者完成现场核验；
- 其它可追溯、足以确认具体建筑或入口的可靠资料。

### 大致位置

以下情况一律保持为“大致位置”：

- 用户或项目成员在网页地图上人工圈点；
- 只根据文字地址、周边建筑或公开报道推测；
- 只能确认建筑，不能确认窗口或入口；
- 来源之间存在冲突。

人工圈点可以提高地图可用性，但不能自动升级为“已确认”。坐标来源应写明“用户地图标记（日期，大致位置）”。

## 用户圈点流程

当前流程不需要账号，也不会直接修改线上数据：

1. 打开地点详情。
2. 点击“纠错反馈”。
3. 选择“在地图上重新圈位置”。
4. 在地图上单击建议位置。
5. 浏览器把草稿存入 `localStorage`，键名为 `hustmap-calibration-draft-v2`。
6. 使用“复制校准结果”或“下载 JSON”交给维护者。
7. 维护者审核后更新 `database/seed.json`，并运行 `node database/init.mjs` 同步本地 SQLite。

校准草稿包含目标地点、同组地点 ID、新旧经纬度和 `locationStatus: "大致位置"`。清除浏览器网站数据会删除草稿。

未来将用户提交接入后端审核队列的方案见[角色、权限与纠错审核设计](../roles-and-review.md)。

## 应用校准结果

维护者收到 JSON 后应：

1. 核对 `placeIds` 与地点名称，避免把同坐标但不属于同一建筑的地点一起移动。
2. 在华科官方地图、OpenStreetMap 或现场资料中复核新位置。
3. 更新 `longitude`、`latitude` 和 `coordinateSource`。
4. 人工圈点继续设置 `locationStatus: "大致位置"`。
5. 若地点显示名称需要调整，同时更新 `name`、`sourceLabel` 和不再适用的 `locationNote`。
6. 运行数据库初始化与测试。

```powershell
node database/init.mjs
node --check app.js
node --test server/app.test.mjs
```

## 发布前检查

- 首页地图能加载，且仍显示 OpenStreetMap 署名。
- 搜索和食堂／店铺筛选正常。
- 合并标记中的所有详情按钮都可用。
- 人工圈点仍显示虚线“大致位置”样式。
- “详情 → 纠错反馈 → 地图圈点”流程可进入和退出。
- 导出的 JSON 包含新旧坐标及地点 ID。
- GitHub Pages 上的 `database/seed.json` 已更新。

## 已知限制

- GitHub Pages 是静态托管，无法直接保存用户提交。
- OpenStreetMap 底图依赖网络连接。
- 当前草稿只保存在提交者浏览器中，没有跨设备同步。
- 管理员审核、正式反馈提交、用户账号和服务端写入仍是后续功能。

