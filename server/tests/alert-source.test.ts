/**
 * 行为 7：数据源停止产出时，其名下激活告警必须立即解除——
 *  - 手动关闭：关闭那一刻告警即转为 resolved 并出事件，不再干等恢复后的新点；
 *  - 采集异常：源转入 error 的同一拍即解除；
 *  - 重新打开后按新读数正常判定，遗留告警不复活、不误报；
 *  - 一路源的开关不影响其它健康源的告警判定。
 * 全程只打后端 HTTP / WebSocket 接口，不开浏览器。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, captureWsMessage, startServer, type TestServer } from './helpers/server';

describe('数据源停用与告警解除联动', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer({ tickMs: 100000 }); // 极大节拍：不产生随机点干扰，节拍由 /test/tick 显式驱动
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

  async function eventsOf(ruleId: string): Promise<any[]> {
    return (await api(server, '/alerts/events')).body.filter((e: any) => e.ruleId === ruleId);
  }

  it('手动关闭数据源：激活告警立即解除并产生 resolved 事件，且通过 WS 推送', async () => {
    const created = await api(server, '/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({ sourceId: 'memory', level: 'warning', operator: '>', threshold: 70, note: '内存偏高' }),
    });
    expect(created.status).toBe(201);
    const rule = created.body;

    // 构造一条正在激活的告警
    const fired = await ingest('memory', 95);
    expect(fired.body.events.some((e: any) => e.ruleId === rule.id && e.phase === 'fired')).toBe(true);
    expect(await activeRuleIds()).toContain(rule.id);

    // 先接上 WS（等首帧快照确保连接就绪），再关闭源：解除动作应当实时推给页面
    const beforeDisable = Date.now();
    const push = await captureWsMessage(
      server.baseUrl.replace('http', 'ws') + '/api/ws',
      async () => {
        const disable = await setEnabled('memory', false);
        expect(disable.status).toBe(200);
        expect(disable.body.enabled).toBe(false);
      },
      (msg) => msg.type === 'alert_event' && msg.event.ruleId === rule.id && msg.event.phase === 'resolved',
    );

    // 立刻查询：告警已不在激活列表，而不是继续挂着
    expect(await activeRuleIds()).not.toContain(rule.id);

    // 事件记录里有一条对应的解除记录，时间就是关闭这一刻（不等下一次阈值判定）
    const resolved = (await eventsOf(rule.id)).find((e) => e.phase === 'resolved');
    expect(resolved).toBeTruthy();
    expect(resolved.sourceId).toBe('memory');
    expect(resolved.ts).toBeGreaterThanOrEqual(beforeDisable);

    // WS 推送的 alert_event 携带最新激活列表，界面据此撤销变色与横幅
    expect(push.actives.map((a: any) => a.ruleId)).not.toContain(rule.id);

    // 关闭期间修改规则阈值：源已停采，不得拿旧读数重判出虚假告警
    const eventCountBeforeEdit = (await api(server, '/alerts/events')).body.length;
    const edit = await api(server, `/alerts/rules/${rule.id}`, {
      method: 'PUT',
      body: JSON.stringify({ threshold: 10 }),
    });
    expect(edit.status).toBe(200);
    expect(await activeRuleIds()).not.toContain(rule.id);
    expect((await api(server, '/alerts/events')).body.length).toBe(eventCountBeforeEdit);

    // 重新打开：遗留告警不复活，也不产生任何新事件
    const enable = await setEnabled('memory', true);
    expect(enable.body.enabled).toBe(true);
    expect(await activeRuleIds()).not.toContain(rule.id);
    expect((await api(server, '/alerts/events')).body.length).toBe(eventCountBeforeEdit);

    // 恢复后按新读数正常判定：安全值不触发，越限值才触发
    await api(server, `/alerts/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ threshold: 70 }) });
    const safe = await ingest('memory', 50);
    expect(safe.body.events).toHaveLength(0);
    expect(await activeRuleIds()).not.toContain(rule.id);

    const again = await ingest('memory', 95);
    expect(again.body.events.some((e: any) => e.ruleId === rule.id && e.phase === 'fired')).toBe(true);
    expect(await activeRuleIds()).toContain(rule.id);

    // 收尾：删规则即解除，别影响后续用例
    await api(server, `/alerts/rules/${rule.id}`, { method: 'DELETE' });
    expect(await activeRuleIds()).not.toContain(rule.id);
  });

  it('关闭一路源只解除它自己的告警，其它健康源的激活告警原样保留', async () => {
    const netRule = (
      await api(server, '/alerts/rules', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'network', level: 'critical', operator: '>', threshold: 50 }),
      })
    ).body;
    const cpuRule = (
      await api(server, '/alerts/rules', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'cpu', level: 'warning', operator: '>', threshold: 50 }),
      })
    ).body;

    await ingest('network', 120);
    await ingest('cpu', 90);
    expect(await activeRuleIds()).toEqual(expect.arrayContaining([netRule.id, cpuRule.id]));
    // cpu 规则此时只有构造激活时的那一条 fired 事件
    expect((await eventsOf(cpuRule.id)).map((e) => e.phase)).toEqual(['fired']);

    // 关闭 network：只有 network 的告警解除
    await setEnabled('network', false);
    const actives = await activeRuleIds();
    expect(actives).not.toContain(netRule.id);
    expect(actives).toContain(cpuRule.id);
    expect((await eventsOf(netRule.id)).some((e) => e.phase === 'resolved')).toBe(true);
    // cpu 一路正常：没有新增任何针对它的事件，告警该怎么判还怎么判
    expect((await eventsOf(cpuRule.id)).map((e) => e.phase)).toEqual(['fired']);

    // network 重开：cpu 告警依旧不受牵连；network 遗留告警不复活
    await setEnabled('network', true);
    const activesAfter = await activeRuleIds();
    expect(activesAfter).toContain(cpuRule.id);
    expect(activesAfter).not.toContain(netRule.id);
    expect((await eventsOf(cpuRule.id)).map((e) => e.phase)).toEqual(['fired']);

    // 收尾
    await api(server, `/alerts/rules/${netRule.id}`, { method: 'DELETE' });
    await api(server, `/alerts/rules/${cpuRule.id}`, { method: 'DELETE' });
  });

  it('源进入采集异常（error）的同一拍，其激活告警立即解除，不等恢复后的新点', async () => {
    const created = await api(server, '/alerts/rules', {
      method: 'POST',
      // online 随机游走软上限 4900，阈值 5000 保证恢复后的真实随机点绝不会误触发
      body: JSON.stringify({ sourceId: 'online', level: 'critical', operator: '>', threshold: 5000 }),
    });
    const rule = created.body;

    await ingest('online', 6000);
    expect(await activeRuleIds()).toContain(rule.id);

    // 强制 online 下一拍进入故障，然后显式跑一个节拍
    const fault = await api(server, '/test/fault', {
      method: 'POST',
      body: JSON.stringify({ sourceId: 'online', ticks: 1 }),
    });
    expect(fault.body.ok).toBe(true);
    const beforeTick = Date.now();
    const tick = await api(server, '/test/tick', { method: 'POST', body: JSON.stringify({}) });

    // 这一拍 online 没有产生任何新点，但告警已经解除
    expect(tick.body.points.some((p: any) => p.sourceId === 'online')).toBe(false);
    expect(await activeRuleIds()).not.toContain(rule.id);
    const resolved = (await eventsOf(rule.id)).find((e) => e.phase === 'resolved');
    expect(resolved).toBeTruthy();
    expect(resolved.ts).toBeGreaterThanOrEqual(beforeTick);
    expect((await api(server, '/sources/online')).body.status).toBe('error');

    // 故障自愈后再跑一拍：恢复产点，新读数未越限则告警不复活
    const tick2 = await api(server, '/test/tick', { method: 'POST', body: JSON.stringify({}) });
    expect(tick2.body.points.some((p: any) => p.sourceId === 'online')).toBe(true);
    expect((await api(server, '/sources/online')).body.status).toBe('ok');
    expect(await activeRuleIds()).not.toContain(rule.id);

    // 收尾
    await api(server, `/alerts/rules/${rule.id}`, { method: 'DELETE' });
  });
});
