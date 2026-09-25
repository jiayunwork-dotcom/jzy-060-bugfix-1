/**
 * 告警规则管理面板：规则增删改，区分警告/严重两档。
 * 仪表板页与数据源页复用同一组件。
 */
import { useState } from 'react';
import { api } from '../api/client';
import type { AlertLevel, AlertOperator, AlertRule, SourceState } from '../types';
import { useDashboard } from '../store/useDashboard';

interface Props {
  /** 只展示/管理某一路源的规则；不传则管理全部 */
  fixedSourceId?: string;
  sources: SourceState[];
}

const emptyDraft = {
  level: 'warning' as AlertLevel,
  operator: '>' as AlertOperator,
  threshold: '',
  note: '',
};

export default function AlertRulesPanel({ fixedSourceId, sources }: Props) {
  const rules = useDashboard((s) => s.rules);
  const actives = useDashboard((s) => s.actives);
  const refreshRules = useDashboard((s) => s.refreshRules);

  const [sourceId, setSourceId] = useState(fixedSourceId ?? sources[0]?.def.id ?? '');
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shownRules = rules.filter((r) => !fixedSourceId || r.sourceId === fixedSourceId);
  const nameOf = (id: string) => sources.find((s) => s.def.id === id)?.def.name ?? id;
  const unitOf = (id: string) => sources.find((s) => s.def.id === id)?.def.unit ?? '';

  const resetForm = () => {
    setDraft({ ...emptyDraft });
    setEditingId(null);
    setError(null);
  };

  const submit = async () => {
    const threshold = Number(draft.threshold);
    if (!sourceId) return setError('请选择指标');
    if (!Number.isFinite(threshold)) return setError('阈值必须是数字');
    try {
      if (editingId) {
        await api.updateRule(editingId, { sourceId, level: draft.level, operator: draft.operator, threshold, note: draft.note });
      } else {
        await api.createRule({ sourceId, level: draft.level, operator: draft.operator, threshold, enabled: true, note: draft.note });
      }
      await refreshRules();
      resetForm();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startEdit = (rule: AlertRule) => {
    setEditingId(rule.id);
    setSourceId(rule.sourceId);
    setDraft({ level: rule.level, operator: rule.operator, threshold: String(rule.threshold), note: rule.note ?? '' });
    setError(null);
  };

  const toggle = async (rule: AlertRule) => {
    await api.updateRule(rule.id, { enabled: !rule.enabled });
    await refreshRules();
  };

  const remove = async (rule: AlertRule) => {
    await api.deleteRule(rule.id);
    if (editingId === rule.id) resetForm();
    await refreshRules();
  };

  return (
    <div className="rules-panel">
      <div className="rules-form">
        <h4>{editingId ? '编辑告警规则' : '新增告警规则'}</h4>
        <div className="form-row">
          <label>指标</label>
          <select value={sourceId} disabled={!!fixedSourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => (
              <option key={s.def.id} value={s.def.id}>
                {s.def.name}（{s.def.unit}）
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>级别</label>
          <div className="seg">
            <button type="button" className={draft.level === 'warning' ? 'seg-btn seg-warning active' : 'seg-btn seg-warning'} onClick={() => setDraft({ ...draft, level: 'warning' })}>
              警告
            </button>
            <button type="button" className={draft.level === 'critical' ? 'seg-btn seg-critical active' : 'seg-btn seg-critical'} onClick={() => setDraft({ ...draft, level: 'critical' })}>
              严重
            </button>
          </div>
        </div>
        <div className="form-row">
          <label>条件</label>
          <select value={draft.operator} onChange={(e) => setDraft({ ...draft, operator: e.target.value as AlertOperator })}>
            <option value=">">&gt; 大于</option>
            <option value=">=">&gt;= 大于等于</option>
            <option value="<">&lt; 小于</option>
            <option value="<=">&lt;= 小于等于</option>
          </select>
          <input
            type="number"
            step="0.01"
            placeholder={`阈值 ${unitOf(sourceId)}`}
            value={draft.threshold}
            onChange={(e) => setDraft({ ...draft, threshold: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label>备注</label>
          <input type="text" placeholder="如：CPU 过八成报" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={submit}>
            {editingId ? '保存修改' : '添加规则'}
          </button>
          {editingId && (
            <button type="button" className="btn" onClick={resetForm}>
              取消
            </button>
          )}
        </div>
      </div>

      <div className="rules-list">
        <h4>已有规则（{shownRules.length}）</h4>
        {shownRules.length === 0 && <div className="rules-empty">还没有规则，先在上方添加一条。</div>}
        {shownRules.map((rule) => {
          const active = actives.some((a) => a.ruleId === rule.id);
          return (
            <div key={rule.id} className={`rule-item ${!rule.enabled ? 'rule-disabled' : ''} ${active ? (rule.level === 'critical' ? 'rule-active-critical' : 'rule-active-warning') : ''}`}>
              <div className="rule-main">
                <span className={`rule-level level-${rule.level}`}>{rule.level === 'critical' ? '严重' : '警告'}</span>
                <span className="rule-expr">
                  <strong>{fixedSourceId ? nameOf(rule.sourceId) : nameOf(rule.sourceId)}</strong> {rule.operator} {rule.threshold}
                  {unitOf(rule.sourceId) ? ` ${unitOf(rule.sourceId)}` : ''}
                </span>
                {active && <span className="rule-firing">已触发</span>}
                {rule.note && <span className="rule-note">{rule.note}</span>}
              </div>
              <div className="rule-ops">
                <button type="button" className="btn btn-mini" onClick={() => toggle(rule)}>
                  {rule.enabled ? '停用' : '启用'}
                </button>
                <button type="button" className="btn btn-mini" onClick={() => startEdit(rule)}>
                  编辑
                </button>
                <button type="button" className="btn btn-mini btn-danger" onClick={() => remove(rule)}>
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
