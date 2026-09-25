/** 内置多路指标定义：系统指标 + 业务指标。 */
import type { SourceDef } from '../types';

export const SOURCE_DEFS: SourceDef[] = [
  {
    id: 'cpu',
    name: 'CPU 使用率',
    kind: 'system',
    unit: '%',
    max: 100,
    decimals: 1,
    description: '整机 CPU 使用率',
  },
  {
    id: 'memory',
    name: '内存占用',
    kind: 'system',
    unit: '%',
    max: 100,
    decimals: 1,
    description: '已用内存占总内存百分比',
  },
  {
    id: 'network',
    name: '网络吞吐',
    kind: 'system',
    unit: 'MB/s',
    max: 125,
    decimals: 2,
    description: '网卡收发合计吞吐',
  },
  {
    id: 'rps',
    name: '每秒请求数',
    kind: 'business',
    unit: 'req/s',
    max: 2000,
    decimals: 0,
    description: '入口网关每秒请求量',
  },
  {
    id: 'online',
    name: '在线人数',
    kind: 'business',
    unit: '人',
    max: 5000,
    decimals: 0,
    description: '当前在线连接用户数',
  },
  {
    id: 'error_rate',
    name: '错误率',
    kind: 'business',
    unit: '%',
    max: 10,
    decimals: 2,
    description: '5xx / 总请求比例',
  },
];
