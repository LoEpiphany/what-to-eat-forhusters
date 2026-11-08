// cloud-functions/[[default]].mjs
import express from 'express';
import { createClient } from '@libsql/client/web';
import { createApp } from '../server/app.mjs';

// 1. 初始化数据库连接
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:database/meishi.sqlite',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 2. 在后台静默执行一次数据库初始化（防止阻塞启动）
import('../database/init.mjs').then(m => m.default(client)).catch(console.error);

// 3. 拿到你的原生 http.Server 实例
const originalServer = createApp(client);

// 4. 创建一个 Express 实例作为“外壳”
const app = express();

// 5. 核心魔法：拦截所有请求，直接丢给你的原生 Server 去处理
app.all('*', (req, res) => {
  originalServer.emit('request', req, res);
});

// 6. 导出给 EdgeOne Pages 使用
export default app;