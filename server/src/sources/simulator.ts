/**
 * 指标模拟器：用带高斯噪声的随机游走 + 日内正弦周期生成逼真曲线。
 * 每一路源偶尔进入短时“异常”状态（不产点、状态置 error），随后自愈，
 * 故障由固定种子驱动，避免测试里出现不可控波动。
 */
import type { MetricPoint } from '../types';
import { gaussian, mulberry32 } from '../util/random';
import type { SourceRegistry } from './registry';

interface Walker {
  base: number;
  amplitude: number;
  min: number;
  max: number;
  /** 游走噪声强度（每拍） */
  vol: number;
  /** 日内周期相位权重 */
  daily: number;
  value: number;
}

const WALKERS: Record<string, Omit<Walker, 'value'>> = {
  cpu: { base: 42, amplitude: 18, min: 3, max: 99, vol: 4, daily: 1 },
  memory: { base: 60, amplitude: 10, min: 15, max: 96, vol: 1.2, daily: 1 },
  network: { base: 45, amplitude: 22, min: 0.5, max: 120, vol: 6, daily: 1 },
  rps: { base: 800, amplitude: 450, min: 20, max: 1950, vol: 60, daily: 1 },
  online: { base: 1800, amplitude: 1200, min: 30, max: 4900, vol: 90, daily: 1 },
  error_rate: { base: 0.8, amplitude: 0.9, min: 0, max: 9, vol: 0.25, daily: 0 },
};

const FAULT_P_PROB = 0.0015; // 每拍进入故障的概率
const FAULT_TICKS = 3; // 故障持续拍数
const DAY_MS = 24 * 60 * 60 * 1000;

export class Simulator {
  private registry: SourceRegistry;
  private rand = mulberry32(20260920);
  private walkers = new Map<string, Walker>();
  private faultLeft = new Map<string, number>();

  constructor(registry: SourceRegistry) {
    this.registry = registry;
    for (const [id, spec] of Object.entries(WALKERS)) {
      this.walkers.set(id, { ...spec, value: spec.base });
    }
  }

  private rawValue(id: string, ts: number): number {
    const w = this.walkers.get(id);
    if (!w) return 0;
    const phase = w.daily ? Math.sin((ts / DAY_MS) * Math.PI * 2 - Math.PI / 2) : 0;
    w.value += gaussian(this.rand) * w.vol;
    let v = w.value + phase * w.amplitude;
    // 越过边界时反向拉回，形成软墙
    if (v < w.min) {
      v = w.min + (w.min - v) * 0.3;
      w.value = v;
    }
    if (v > w.max) {
      v = w.max - (v - w.max) * 0.3;
      w.value = v;
    }
    return v;
  }

  private inFault(id: string): boolean {
    const left = this.faultLeft.get(id) ?? 0;
    if (left > 0) {
      this.faultLeft.set(id, left - 1);
      return true;
    }
    if (this.rand() < FAULT_P_PROB) {
      this.faultLeft.set(id, FAULT_TICKS);
      return true;
    }
    return false;
  }

  /** 生成一个节拍：仅对“已开启且非异常”的源产出数据点。 */
  tick(ts: number): MetricPoint[] {
    const out: MetricPoint[] = [];
    for (const state of this.registry.list()) {
      if (!state.enabled) continue;
      if (this.inFault(state.def.id)) {
        this.registry.reportStatus(state.def.id, 'error', '采集代理超时，暂时无法获取指标');
        continue;
      }
      if (state.status === 'error') {
        this.registry.reportStatus(state.def.id, 'ok', null);
      }
      const raw = this.rawValue(state.def.id, ts);
      const value = Number(raw.toFixed(state.def.decimals));
      out.push({ sourceId: state.def.id, ts, value });
      this.registry.reportPoint(state.def.id, ts);
    }
    return out;
  }

  /**
   * 启动预填：在不产生实时推送/告警的前提下，把最近一段时间的模拟点
   * 直接写入历史留档，让页面初次打开就有五分钟走势可看。
   */
  prefill(now: number, spanMs: number, stepMs: number, sink: (sourceId: string, ts: number, value: number) => void): void {
    for (const state of this.registry.list()) {
      if (!state.enabled) continue;
      for (let ts = now - spanMs; ts < now; ts += stepMs) {
        sink(state.def.id, ts, Number(this.rawValue(state.def.id, ts).toFixed(state.def.decimals)));
      }
      this.registry.reportPoint(state.def.id, now - stepMs);
    }
  }
}
