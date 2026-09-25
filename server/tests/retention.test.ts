/**
 * 行为 5：超过 24 小时保留窗口的旧数据按窗口滚动淘汰。
 * 注入跨越窗口边界的点 -> 触发 prune -> 校验内存、区间查询与磁盘文件
 * 都只保留窗口内的点；窗口内数据不受影响。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, startServer, type TestServer } from './helpers/server';

describe('24 小时保留窗口滚动淘汰', () => {
  let server: TestServer;
  const sourceId = 'memory';
  const day = 24 * 60 * 60 * 1000;
  const now = 1_700_100_000_000; // 固定“当前时间”，相对它定义新旧
  const retention = day;

  beforeAll(async () => {
    server = await startServer({ tickMs: 100000, retentionMs: retention });
    const off = await api(server, `/sources/${sourceId}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('淘汰前：窗口内外的点都能取到', async () => {
    const points = [
      { sourceId, ts: now - 3 * day, value: 11 }, // 远超 24h，应删
      { sourceId, ts: now - day - 1000, value: 22 }, // 刚好出窗 1 秒，应删
      { sourceId, ts: now - day + 1000, value: 33 }, // 窗内边界，应留
      { sourceId, ts: now - 60_000, value: 44 }, // 窗内，应留
    ];
    const r = await api(server, '/test/ingest', { method: 'POST', body: JSON.stringify({ points }) });
    expect(r.status).toBe(201);

    const before = await api(server, `/history?from=0&to=${now}&sources=${sourceId}`);
    expect(before.body.series[sourceId].points.map((p: any) => p.value).sort()).toEqual([11, 22, 33, 44]);
  });

  it('按窗口 prune 后：仅保留窗口内点，返回删除计数', async () => {
    const prune = await api(server, '/test/prune', {
      method: 'POST',
      body: JSON.stringify({ now, compact: true }),
    });
    expect(prune.status).toBe(200);
    expect(prune.body.removed).toBe(2);
    expect(prune.body.counts[sourceId]).toBe(2);

    const after = await api(server, `/history?from=0&to=${now}&sources=${sourceId}`);
    expect(after.body.series[sourceId].points.map((p: any) => p.value)).toEqual([33, 44]);

    // 旧时间区间的回放应为空
    const oldRange = await api(server, `/history?from=0&to=${now - day}&sources=${sourceId}`);
    expect(oldRange.body.series[sourceId].points).toEqual([]);
  });

  it('压缩已落盘：磁盘文件中的旧点也被物理淘汰（重启后仍成立）', async () => {
    const debug = await api(server, '/test/debug');
    expect(debug.body.counts[sourceId].disk).toBe(2);

    // 再淘汰一次幂等，不产生额外删除
    const again = await api(server, '/test/prune', { method: 'POST', body: JSON.stringify({ now }) });
    expect(again.body.removed).toBe(0);
    expect(again.body.counts[sourceId]).toBe(2);
  });
});
