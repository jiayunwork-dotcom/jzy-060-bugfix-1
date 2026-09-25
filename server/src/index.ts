/** 服务入口：加载配置、启动 HTTP + WebSocket 服务。 */
import { loadConfig } from './config';
import { createApp } from './app';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, rt } = await createApp(config);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`监控仪表板已启动: http://${config.host}:${config.port} (节拍 ${config.tickMs}ms, 保留 ${config.retentionMs}ms)`);

  const shutdown = (signal: string) => {
    app.log.info(`收到 ${signal}，正在落盘并退出…`);
    rt.stop();
    app.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
