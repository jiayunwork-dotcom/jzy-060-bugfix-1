/**
 * 数据源注册表：维护每一路指标的元数据、采集开关与运行状态。
 * 开关状态持久化到 ConfigStore；状态（正常/异常）由模拟器上报。
 */
import type { SourceDef, SourceState, SourceStatus } from '../types';
import { SOURCE_DEFS } from './defs';
import type { ConfigStore } from '../storage/configStore';

export class SourceRegistry {
  private states = new Map<string, SourceState>();
  private config: ConfigStore;

  constructor(config: ConfigStore, defs: SourceDef[] = SOURCE_DEFS) {
    this.config = config;
    for (const def of defs) {
      this.states.set(def.id, {
        def,
        // 默认全部开启；用户的历史选择优先
        enabled: config.isEnabled(def.id, true),
        status: 'ok',
        lastError: null,
        lastPointTs: null,
      });
    }
  }

  list(): SourceState[] {
    return [...this.states.values()];
  }

  get(id: string): SourceState | undefined {
    return this.states.get(id);
  }

  setEnabled(id: string, enabled: boolean): SourceState | undefined {
    const s = this.states.get(id);
    if (!s) return undefined;
    s.enabled = enabled;
    this.config.setEnabled(id, enabled);
    return s;
  }

  reportStatus(id: string, status: SourceStatus, error: string | null): void {
    const s = this.states.get(id);
    if (!s) return;
    s.status = status;
    s.lastError = status === 'error' ? error : null;
  }

  reportPoint(id: string, ts: number): void {
    const s = this.states.get(id);
    if (s) s.lastPointTs = ts;
  }
}
