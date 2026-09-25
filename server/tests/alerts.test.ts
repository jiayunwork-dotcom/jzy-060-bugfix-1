/**
 * 行为 2 & 3：
 *  - 指标越过阈值时产生对应级别（warning / critical）告警，回落后解除；
 *  - 同一规则改动阈值后，立刻按新阈值判定。
 * 注入路径走 /api/test/ingest，数据同样真实留档并触发告警管线。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, startServer, type TestServer } from './helpers/server';

describe('告警规则', () => {
  let server: TestServer;
  const sourceId = 'cpu';

  beforeAll(async () => {
    server = await startServer({ tickMs: 100000 }); // 极大节拍：测试期间不产生随机点干扰
  });
  afterAll(async () => {
    await server.stop();
  });

  async function ingest(value: number, ts = Date.now()) {
    return api(server, '/test/ingest', {
      method: 'POST',
      body: JSON.stringify({ points: [{ sourceId, ts, value }] }),
    });
  }

  it('越过 warning 阈值产生 warning，越过更高的 critical 阈值产生 critical，回落依次解除', async () => {
    const warn = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId, level: 'warning', operator: '>', threshold: 60, note: 'CPU 警告' }),
    });
    expect(warn.status).toBe(201);
    const warnRule = warn.body;
    const crit = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId, level: 'critical', operator: '>', threshold: 80, note: 'CPU 严重' }),
    });
    const critRule = crit.body;

    // 安全值：无激活告警
    await ingest(40);
    expect((await api(server, '/alerts/active')).body).toHaveLength(0);

    // 越过 60，只触发 warning
    let r = await ingest(70);
    const firedWarn = r.body.events.find((e: any) => e.ruleId === warnRule.id && e.phase === 'fired');
    expect(firedWarn).toBeTruthy();
    expect(firedWarn.level).toBe('warning');
    let active = (await api(server, '/alerts/active')).body;
    expect(active.map((a: any) => a.ruleId)).toContain(warnRule.id);
    expect(active.map((a: any) => a.ruleId)).not.toContain(critRule.id);

    // 越过 80，再触发 critical（warning 仍激活）
    r = await ingest(90);
    expect(r.body.events.some((e: any) => e.ruleId === critRule.id && e.phase === 'fired' && e.level === 'critical')).toBe(true);
    active = (await api(server, '/alerts/active')).body;
    expect(active).toHaveLength(2);

    // 回落到 60 与 80 之间：critical 解除，warning 仍在
    r = await ingest(70);
    expect(r.body.events.some((e: any) => e.ruleId === critRule.id && e.phase === 'resolved')).toBe(true);
    active = (await api(server, '/alerts/active')).body;
    expect(active.map((a: any) => a.ruleId)).toEqual([warnRule.id]);

    // 完全回落到安全侧：warning 解除
    r = await ingest(40);
    expect(r.body.events.some((e: any) => e.ruleId === warnRule.id && e.phase === 'resolved')).toBe(true);
    expect((await api(server, '/alerts/active')).body).toHaveLength(0);

    // 事件历史可查，fired/resolved 成对存在
    const events = (await api(server, '/alerts/events')).body;
    expect(events.filter((e: any) => e.ruleId === critRule.id).map((e: any) => e.phase).sort()).toEqual(['fired', 'resolved']);
  });

  it('同一规则修改阈值后，立即按新阈值判定（无需等待新点，也不重新造数）', async () => {
    const created = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId, level: 'warning', operator: '>', threshold: 90, note: '可变阈值' }),
    });
    const rule = created.body;

    // 当前真实最近值 40 < 90，不激活
    await ingest(40);
    expect((await api(server, '/alerts/active')).body.find((a: any) => a.ruleId === rule.id)).toBeFalsy();

    // 把阈值改到 40 以下：用“最近一个真实值 40”重判，应立即触发
    let updated = await api(server, `/alerts/rules/${rule.id}`, {
      method: 'PUT',
      body: JSON.stringify({ threshold: 30 }),
    });
    expect(updated.body.threshold).toBe(30);
    let active = (await api(server, '/alerts/active')).body;
    expect(active.some((a: any) => a.ruleId === rule.id && a.level === 'warning')).toBe(true);

    // 再把阈值放宽回 90：同样立即解除
    updated = await api(server, `/alerts/rules/${rule.id}`, {
      method: 'PUT',
      body: JSON.stringify({ threshold: 90 }),
    });
    active = (await api(server, '/alerts/active')).body;
    expect(active.some((a: any) => a.ruleId === rule.id)).toBe(false);

    // 删除规则：接口返回成功且列表清空该规则
    const del = await api(server, `/alerts/rules/${rule.id}`, { method: 'DELETE' });
    expect(del.body.ok).toBe(true);
    expect((await api(server, '/alerts/rules')).body.some((x: any) => x.id === rule.id)).toBe(false);
  });

  it('规则支持增删改且校验级别/运算符', async () => {
    const bad = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId, level: 'pager', operator: '>', threshold: 10 }),
    });
    expect(bad.status).toBe(400);

    const ok = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId: 'error_rate', level: 'critical', operator: '>', threshold: 5, note: '高错误率' }),
    });
    expect(ok.status).toBe(201);
    const patched = await api(server, `/alerts/rules/${ok.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ level: 'warning', threshold: 3, note: '降级为警告' }),
    });
    expect(patched.body.level).toBe('warning');
    expect(patched.body.threshold).toBe(3);
  });
});
