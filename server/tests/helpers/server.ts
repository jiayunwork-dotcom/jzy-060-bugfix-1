/**
 * 测试公共设施：以子进程拉起“构建后的真实服务”，通过 HTTP / WebSocket
 * 对真实监听端口做黑盒断言（不直接调用任何内部模块）。
 * 每个测试文件使用独立临时数据目录，测完自动清理。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket as WS } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', '..', 'dist', 'index.js');

export interface TestServer {
  baseUrl: string;
  dataDir: string;
  stop: () => Promise<void>;
}

let portCounter = 4100;

export async function startServer(opts: { tickMs?: number; retentionMs?: number } = {}): Promise<TestServer> {
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error('未找到 server/dist/index.js，请先执行 npm run build（workspace server）');
  }
  const port = ++portCounter;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dash-test-'));
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      TICK_MS: String(opts.tickMs ?? 250),
      HISTORY_RETENTION_MS: String(opts.retentionMs ?? 24 * 60 * 60 * 1000),
      ENABLE_TEST_API: 'true',
      PREFILL_MS: '0',
      PRUNE_INTERVAL_MS: '3600000',
      LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', () => {
    /* 安静模式；失败时由健康检查超时体现 */
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch {
      /* 尚未监听，继续等 */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('测试服务启动超时');
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    baseUrl,
    dataDir,
    stop: () =>
      new Promise<void>((resolve) => {
        child.kill('SIGTERM');
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish();
        }, 3000);
        const finish = () => {
          clearTimeout(timer);
          try {
            fs.rmSync(dataDir, { recursive: true, force: true });
          } catch {
            /* 忽略清理失败 */
          }
          resolve();
        };
        child.on('exit', finish);
      }),
  };
}

export async function api(
  server: TestServer,
  route: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${server.baseUrl}/api${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 持续收集 WS 消息直到 predicate 命中或超时。 */
export function waitForWsMessage(
  wsUrl: string,
  predicate: (msg: any) => boolean,
  timeoutMs = 5000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('等待 WebSocket 消息超时'));
    }, timeoutMs);
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      } catch {
        /* 忽略无法解析的帧 */
      }
    });
    ws.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * 先建连并等首帧快照（确保 socket 已注册进推送中心），再执行 trigger，
 * 最后等待满足 predicate 的推送消息。用于断言“某个动作触发的一次性推送”。
 */
export async function captureWsMessage(
  wsUrl: string,
  trigger: () => Promise<unknown>,
  predicate: (msg: any) => boolean,
  timeoutMs = 5000,
): Promise<any> {
  const ws = new WS(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待首帧快照超时')), timeoutMs);
      ws.on('message', (data: Buffer) => {
        try {
          if (JSON.parse(data.toString()).type === 'snapshot') {
            clearTimeout(timer);
            resolve();
          }
        } catch {
          /* 忽略无法解析的帧 */
        }
      });
      ws.on('error', reject);
    });

    const message = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 WebSocket 消息超时')), timeoutMs);
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (predicate(msg)) {
            clearTimeout(timer);
            resolve(msg);
          }
        } catch {
          /* 忽略无法解析的帧 */
        }
      });
      ws.on('error', reject);
    });
    await trigger();
    return await message;
  } finally {
    ws.close();
  }
}
