# 运维实时监控仪表板（Real-time Ops Dashboard）

浏览器内的实时监控与历史回放仪表板。后端（Node.js 20 + Fastify + WebSocket）**每秒主动**把多路系统/业务指标推给前端（React + TypeScript + Vite），所有数据点在后端留档 24 小时，支持阈值告警（警告 / 严重两级）、可拖拽布局持久化、区间历史回放（暂停 / 2x / 5x 变速）与数据源采集开关管理。

## 功能一览

| 能力 | 说明 |
| --- | --- |
| 实时推送 | 服务端通过 **一条 WebSocket 长连接** 每秒主动推送，非前端轮询；自动重连 |
| 多路指标 | 系统：CPU、内存、网络吞吐；业务：每秒请求数、在线人数、错误率 |
| 图表 | 折线趋势（最近 5 分钟）、SVG 圆形仪表盘（瞬时值+阈值刻度）、柱状横向对比 |
| 可布局 | react-grid-layout 拖拽换位 / 拉伸改大小，布局防抖保存到后端，下次进入自动恢复 |
| 告警 | 规则增删改；`> >= < <=` 阈值 + 警告/严重两级；触发图表变色、横幅与桌面弹窗，回落自动解除 |
| 历史回放 | 选时间区间，取自后端 24h 真实留档（绝不现场重造），暂停 / 继续 / 1x 2x 5x / 拖动进度 |
| 数据源管理 | 集中查看源列表、正常/异常状态、最近数据点时间，手动开关采集（关闭即不再产点） |
| 持久化 | 历史点（JSONL）、数据源开关、告警规则、用户布局均落盘到容器卷 `/app/data` |

## 快速开始

### Docker（推荐，前后端一起拉起）

```bash
docker compose up -d --build
# 浏览器打开 http://localhost:8080
# 接口前缀 http://localhost:8080/api，WebSocket 路径 /api/ws
```

容器内跑自动化测试：

```bash
docker compose exec dashboard npm run test --workspace server
```

### 本地开发

```bash
npm install                      # 安装两个 workspace 的依赖
npm run dev:server               # 后端 http://127.0.0.1:8080 （tsx 热更新）
npm run dev:web                  # 前端 http://127.0.0.1:5173 （/api 与 ws 代理到 8080）
```

### 生产模式（本机）

```bash
npm run build                    # 构建前端(vite) 与后端(tsc)
npm start                        # 启动一体化服务，访问 http://localhost:8080
```

### 自动化测试（不开浏览器，黑盒打后端接口）

```bash
npm run build --workspace server
npm test                         # vitest：以子进程拉起真实服务，打 HTTP + WebSocket
```

测试通过环境变量 `ENABLE_TEST_API=true` 开启仅测试用的确定性注入/淘汰接口（`/api/test/*`，生产编排中为 `false`），因此无需等待随机模拟时序即可精确锁定行为。

## 被自动化测试锁定的行为

1. **数据源开关**（`tests/sources.test.ts`）：手动关闭后该源不再新增数据点（历史最新时间戳停滞、WS 不再推送），重新打开后恢复推送；开关持久化。
2. **告警触发/回落与级别**（`tests/alerts.test.ts`）：越过阈值产生对应 `warning` / `critical` 告警事件，回落后产生 `resolved` 并从激活列表移除。
3. **阈值改动即时生效**（同上）：同一规则改阈值后，立即用最近一个**真实**值按新阈值重判，无需等新点。
4. **回放真实性**（`tests/history.test.ts`）：注入带独特取值的点后按区间查询，逐点比对 ts/value，区间外的点不混入，重复查询结果稳定（非现场重造）。
5. **24 小时滚动淘汰**（`tests/retention.test.ts`）：越窗旧点被 `prune` 删除（计数可断言），内存、区间查询、压缩后的磁盘文件都只保留窗口内点，且操作幂等。
6. **服务端主动推送**（`tests/realtime.test.ts`）：建连即收快照；客户端不发任何请求也能持续收到多批 `metrics` 帧。

## 后端接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/sources` | 数据源列表（定义、开关、ok/error 状态、最近点时间） |
| PUT | `/api/sources/:id/enabled` | 手动开/关采集，body `{ "enabled": false }` |
| GET/POST | `/api/alerts/rules` | 规则列表 / 新建 |
| PUT/DELETE | `/api/alerts/rules/:id` | 修改（阈值/级别/运算符/启停/备注）/ 删除 |
| GET | `/api/alerts/active` | 当前激活告警 |
| GET | `/api/alerts/events` | 最近告警/解除事件 |
| GET | `/api/history?from&to&sources=a,b` | 区间回放，返回后端真实留存点 |
| GET/PUT | `/api/layout` | 读取 / 保存用户布局 |
| WebSocket | `/api/ws` | 建连下发 `snapshot`，随后服务端推 `metrics` / `source` / `alert_event` / `rules` |

## 目录结构（按职责拆分）

```
server/src/
  config.ts                 环境配置（节拍/保留窗口/数据目录）
  types.ts                  领域类型
  runtime.ts                装配：节拍 -> 留档 -> 告警 -> 推送 -> 淘汰
  sources/
    defs.ts                 6 路指标定义
    registry.ts             数据源注册表（开关/状态）
    simulator.ts            高斯随机游走+日周期+偶发自愈故障的模拟采集
  storage/
    historyStore.ts         JSONL 留档、区间查询、24h 滚动淘汰与压缩
    configStore.ts          开关/规则/布局的原子化 JSON 持久化
  alerts/engine.ts          阈值判定、fired/resolved、改阈值即时重判
  realtime/hub.ts           WebSocket 连接管理与广播
  routes/                   sources / alerts / history / layout / realtime / test
web/src/
  api/client.ts             REST 与 WS 封装
  store/useDashboard.ts     单条 WS 连接 + 5 分钟滑动窗口 + 告警弹窗状态
  components/charts/        GaugeChart / TrendLine / CompareBars 三类图表
  components/               DashboardGrid(拖拽布局) / AlertRulesPanel / AlertBanner / Toasts / ChartCard
  pages/                    DashboardPage / ReplayPage / SourcesPage
```

## 数据留存

- `data/history/<sourceId>.jsonl`：每行 `{ "ts", "value" }`，高频缓冲 2s 批量追加，淘汰时整文件压缩重写。
- `data/config.json`：数据源开关、告警规则、布局（临时文件 + rename 原子写）。
- 保留窗口由 `HISTORY_RETENTION_MS`（默认 86400000 = 24h）控制，后台每分钟巡检淘汰。
