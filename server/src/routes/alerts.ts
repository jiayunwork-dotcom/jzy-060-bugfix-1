/** 告警规则路由：规则增删改查、激活态与事件查询。改动后立即按新阈值重判。 */
import type { FastifyInstance } from 'fastify';
import type { AlertLevel, AlertOperator } from '../types';
import type { Runtime } from '../runtime';

const LEVELS: AlertLevel[] = ['warning', 'critical'];
const OPERATORS: AlertOperator[] = ['>', '<', '>=', '<='];

interface RuleBody {
  sourceId?: unknown;
  level?: unknown;
  operator?: unknown;
  threshold?: unknown;
  enabled?: unknown;
  note?: unknown;
}

interface RuleIdParam {
  id: string;
}

function validateRule(body: RuleBody, rt: Runtime): { ok: true; sourceId: string; level: AlertLevel; operator: AlertOperator; threshold: number; enabled: boolean; note: string } | { ok: false; message: string } {
  const sourceId = String(body.sourceId ?? '');
  if (!rt.registry.get(sourceId)) return { ok: false, message: 'sourceId 不存在' };
  const level = body.level as AlertLevel;
  if (!LEVELS.includes(level)) return { ok: false, message: 'level 必须是 warning 或 critical' };
  const operator = body.operator as AlertOperator;
  if (!OPERATORS.includes(operator)) return { ok: false, message: 'operator 必须是 >、<、>=、<=' };
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold)) return { ok: false, message: 'threshold 必须是数字' };
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
  const note = typeof body.note === 'string' ? body.note : '';
  return { ok: true, sourceId, level, operator, threshold, enabled, note };
}

export default async function alertRoutes(app: FastifyInstance, rt: Runtime): Promise<void> {
  app.get('/alerts/rules', async () => rt.configStore.getRules());

  app.get('/alerts/active', async () => rt.alerts.getActives());

  app.get('/alerts/events', async () => rt.alerts.getEvents(200));

  app.post<{ Body: RuleBody }>('/alerts/rules', async (req, reply) => {
    const v = validateRule(req.body ?? {}, rt);
    if (!v.ok) return reply.code(400).send({ error: 'invalid_rule', message: v.message });
    const rule = rt.configStore.addRule({
      sourceId: v.sourceId,
      level: v.level,
      operator: v.operator,
      threshold: v.threshold,
      enabled: v.enabled,
      note: v.note,
    });
    rt.broadcastRules();
    rt.resyncAlerts();
    return reply.code(201).send(rule);
  });

  app.put<{ Params: RuleIdParam; Body: RuleBody }>('/alerts/rules/:id', async (req, reply) => {
    const existing = rt.configStore.getRule(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'rule_not_found' });
    const v = validateRule({ ...existing, ...(req.body ?? {}) }, rt);
    if (!v.ok) return reply.code(400).send({ error: 'invalid_rule', message: v.message });
    const wasEnabled = existing.enabled;
    const rule = rt.configStore.updateRule(existing.id, {
      sourceId: v.sourceId,
      level: v.level,
      operator: v.operator,
      threshold: v.threshold,
      enabled: v.enabled,
      note: v.note,
    })!;
    rt.broadcastRules();
    if (!v.enabled || !wasEnabled || existing.sourceId !== v.sourceId) {
      // 停用/换绑后旧激活态立即解除；其余改动靠 resync 按新阈值判定
      const gone = rt.alerts.deactivate(existing.id);
      if (gone) rt.emitAlertEvents([gone]);
    }
    rt.resyncAlerts();
    return rule;
  });

  app.delete<{ Params: RuleIdParam }>('/alerts/rules/:id', async (req, reply) => {
    const existing = rt.configStore.getRule(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'rule_not_found' });
    rt.configStore.deleteRule(existing.id);
    const gone = rt.alerts.deactivate(existing.id);
    if (gone) rt.emitAlertEvents([gone]);
    rt.broadcastRules();
    return { ok: true };
  });
}
