/** 运行环境配置，全部可通过环境变量覆盖（测试借此使用独立数据目录与更快节拍）。 */
import path from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  /** 实时数据产出节拍（毫秒），线上约 1000ms 一次 */
  tickMs: number;
  /** 历史保留窗口（毫秒），默认 24 小时 */
  retentionMs: number;
  /** 预填最近多久的历史点（毫秒），打开页面立刻能看到五分钟走势 */
  prefillMs: number;
  /** 后台淘汰巡检间隔（毫秒） */
  pruneIntervalMs: number;
  /** 前端构建产物目录，存在时由后端静态托管 */
  webDist: string | null;
  /** 仅供自动化测试使用的注入/维护接口开关，线上关闭 */
  enableTestApi: boolean;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const webDist = process.env.WEB_DIST || path.join(process.cwd(), '..', 'web', 'dist');
  return {
    port: num('PORT', 8080),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    tickMs: num('TICK_MS', 1000),
    retentionMs: num('HISTORY_RETENTION_MS', 24 * 60 * 60 * 1000),
    prefillMs: num('PREFILL_MS', 5 * 60 * 1000),
    pruneIntervalMs: num('PRUNE_INTERVAL_MS', 60 * 1000),
    webDist,
    enableTestApi: process.env.ENABLE_TEST_API === 'true',
  };
}
