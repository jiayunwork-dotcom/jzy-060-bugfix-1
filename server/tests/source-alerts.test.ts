/**
 * 行为：数据源被手动关闭（或进入采集异常）时，其名下所有激活告警必须立即解除——
 * 激活列表即刻清空、事件记录出现对应 resolved、WS 推送 alert_event，
 * 而不是干等源恢复后凑巧算出一个不越限的新值才把旧告警带走。
 * 同时锁定：重新打开后按新数据正常判定；健康源的告警不受其它源开关牵连。
 * 注入路径走 /api/test/ingest，与真实节拍共用同一条留档+告警+推送管线。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, sleep, startServer, waitForWsMessage, type TestServer } from './helpers/server';

describe('数据源关闭时告警立即解除', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer({ tickMs: 100000 }); // 极大节拍：测试期间不产生随机点干扰
  });
  afterAll(async () => {
    await server.stop();
  });

  async function ingest(sourceId: string, value: number, ts = Date.now()) {
    return api(server, '/test/ingest', {
      method: 'POST',
      body: JSON.stringify({ points: [{ sourceId, ts, value }] }),
    });
  }

  async function setEnabled(sourceId: string, enabled: boolean) {
    return api(server, `/sources/${sourceId}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  async function activeRuleIds(): Promise<string[]> {
    return (await api(server, '/alerts/active')).body.map((a: any) => a.ruleId);
  }

  it('激活告警在源被关闭的那一刻立即解除：激活列表清空、事件记录出现 resolved、WS 同步推送', async () => {
    const sourceId = 'memory';
    const created = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId, level: 'critical', operator: '>', threshold: 90, note: '内存严重' }),
    });
    expect(created.status).toBe(201);
    const rule = created.body;

    // 注入越限值，构造出一条正在激活的告警
    const fired = await ingest(sourceId, 95);
    expect(fired.body.events.some((e: any) => e.ruleId === rule.id && e.phase === 'fired')).toBe(true);
    expect(await activeRuleIds()).toContain(rule.id);

    // 先挂上 WS 监听，再关闭数据源：解除事件应实时推给页面
    const wsUrl = server.baseUrl.replace('http', 'ws') + '/api/ws';
    const resolvedPush = waitForWsMessage(
      wsUrl,
      (msg) => msg.type === 'alert_event' && msg.event.ruleId === rule.id && msg.event.phase === 'resolved',
      5000,
    );
    await sleep(300); // 确保连接已挂上推送中心

    const disable = await setEnabled(sourceId, false);
    expect(disable.status).toBe(200);
    expect(disable.body.enabled).toBe(false);

    // 立刻查询（不等任何采集周期）：激活列表里已经没有这条告警
    expect(await activeRuleIds()).not.toContain(rule.id);

    // 事件记录里能看到对应的解除记录
    const events = (await api(server, '/alerts/events')).body;
    const resolved = events.find((e: any) => e.ruleId === rule.id && e.phase === 'resolved');
    expect(resolved).toBeTruthy();
    expect(resolved.sourceId).toBe(sourceId);

    // 页面通过推送拿到的激活列表同样已清空该告警
    const push = await resolvedPush;
    expect(push.actives.some((a: any) => a.ruleId === rule.id)).toBe(false);
  });

  it('重新打开后旧告警不残留：安全值不误触发，越限照常触发，回落照常解除', async () => {
    const sourceId = 'rps';
    const created = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId, level: 'warning', operator: '>', threshold: 1500, note: 'RPS 警告' }),
    });
    const rule = created.body;

    // 触发后关闭源：告警立即解除
    await ingest(sourceId, 1600);
    expect(await activeRuleIds()).toContain(rule.id);
    await setEnabled(sourceId, false);
    expect(await activeRuleIds()).not.toContain(rule.id);

    // 重新打开，新读数不越限：不应再看到遗留告警，也不产生新的触发
    const enable = await setEnabled(sourceId, true);
    expect(enable.body.enabled).toBe(true);
    const safe = await ingest(sourceId, 1000);
    expect(safe.body.events.some((e: any) => e.ruleId === rule.id && e.phase === 'fired')).toBe(false);
    expect(await activeRuleIds()).not.toContain(rule.id);

    // 越限照常触发、回落照常解除（既有判定行为不变）
    const again = await ingest(sourceId, 1600);
    expect(again.body.events.some((e: any) => e.ruleId === rule.id && e.phase === 'fired')).toBe(true);
    expect(await activeRuleIds()).toContain(rule.id);
    const drop = await ingest(sourceId, 1000);
    expect(drop.body.events.some((e: any) => e.ruleId === rule.id && e.phase === 'resolved')).toBe(true);
    expect(await activeRuleIds()).not.toContain(rule.id);

    // 整个过程中该规则的事件序列：fired/resolved 成对交替，无残留
    const phases = (await api(server, '/alerts/events')).body
      .filter((e: any) => e.ruleId === rule.id)
      .map((e: any) => e.phase)
      .reverse();
    expect(phases).toEqual(['fired', 'resolved', 'fired', 'resolved']);
  });

  it('状态正常的源不受其它源开关牵连；关闭无激活告警的源不产生多余事件', async () => {
    const sourceId = 'cpu';
    const created = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId, level: 'warning', operator: '>', threshold: 90, note: 'CPU 警告' }),
    });
    const rule = created.body;
    await ingest(sourceId, 95);
    expect(await activeRuleIds()).toContain(rule.id);

    // 开关另一路无告警的源：cpu 的激活告警原样保留，该怎么判还怎么判
    await setEnabled('online', false);
    await setEnabled('online', true);
    expect(await activeRuleIds()).toContain(rule.id);
    const events = (await api(server, '/alerts/events')).body;
    expect(events.some((e: any) => e.sourceId === 'online')).toBe(false);

    // cpu 自身回落仍按既有逻辑解除
    const drop = await ingest(sourceId, 50);
    expect(drop.body.events.some((e: any) => e.ruleId === rule.id && e.phase === 'resolved')).toBe(true);
    expect(await activeRuleIds()).not.toContain(rule.id);
  });
});
