import 'dotenv/config';
import { createClient } from '@libsql/client';
import { createApp } from './app.mjs';

// 创建云端数据库客户端（如果是本地开发没有配置环境变量，会自动降级为本地 SQLite 文件）
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:database/meishi.sqlite',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 执行初始化（迁移表结构、导入初始数据）
console.log('正在检查并初始化数据库...');
await import('../database/init.mjs').then(m => m.default(client));

const port = process.env.PORT || 3000;
const host = '0.0.0.0'; // 必须监听 0.0.0.0 才能被云平台外部访问

const server = createApp(client);
server.listen(port, host, () => {
  console.log(`觅食地图服务已启动：http://${host}:${port}/`);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));