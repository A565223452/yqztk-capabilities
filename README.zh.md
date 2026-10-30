# @yqztk/capabilities

**Verifiable + Private compute layer** — 由 yuanqizhike.com 的单页工具沉淀出的无头能力层。

## 这是什么

站点的 823 个工具是「给人点的页面」；这里把它们里可函数化的部分重做成「给程序调的能力」。
定位不是「AI 也会算的东西」，而是 **AI 算了但没人敢信** 与 **合规不允许送上云** 的部分。

对外提供两种形态：

| 形态 | 入口 | 用途 |
|---|---|---|
| 库 | `import { maskPII } from './src/privacy/mask-pii.mjs'` | 直接嵌进你的程序 |
| **MCP server** | `node bin/mcp-server.mjs`（stdio） | 给任何 AI Agent 调用 |

## 三条约束 + 两条纪律

| 约束 | 含义 | 怎么保证 |
|---|---|---|
| **Deterministic** | 相同输入必得相同输出 | 禁止 `Math.random()`、禁止 `Date.now()`；随机一律显式 `seed`，时间一律显式 `now` |
| **Private** | 零网络访问，数据不离开调用进程 | 禁止 `fetch` / `XHR` / `WebSocket`；`health/bmi` 甚至**在签名层面拒绝** age/gender |
| **Auditable** | 失败边界明确，并返回「做了什么」的轨迹 | 非法输入抛 `RangeError`；返回 detections / identities / warnings |

前两条不是靠自觉，而是**由测试强制**（见 `test/discipline.test.mjs`）：它扫描全部源码文本，
剥离注释后检查禁用调用、网络调用与非相对路径 import。守卫本身也用变异法验证过有效性。

## 零依赖不是洁癖

`package.json` 里没有 `dependencies`，这是刻意的：本层的卖点之一是「**可作为依赖被审计**」——
只要引入一个传递依赖，审计范围就失控。唯一用到的内置模块是 `node:crypto`（用于真 SHA-256）。
连 MCP server 都是手写的（MCP 的 stdio 传输本质就是「一行一个 JSON-RPC 消息」），
所以使用者**不需要 `npm install` 就能跑起来**。

## 目录结构

```
packages/capabilities/
├── package.json                    # 零 dependencies
├── README.md
├── bin/mcp-server.mjs              # stdio 入口（薄绑定）
├── src/
│   ├── index.mjs                   # 出口 + REGISTRY（供文档站/MCP 自动生成）
│   ├── lib/prng.mjs                # 确定性 PRNG（mulberry32）
│   ├── mcp/server.mjs              # MCP 协议逻辑（纯函数，无 IO）
│   ├── mcp/tools.mjs               # 38 个工具定义
│   ├── privacy/  finance/  text/  health/  weather/
│   └── units/  media/  business/  time/  security/  religion/  gaming/
└── test/                           # 361 个测试，全部用内置 node:test
```

## 能力清单（17 个模块 / 35 个能力 / MCP 暴露 38 个工具）

| 模块 | 能力 | 一句话 |
|---|---|---|
| `privacy/mask-pii` | 脱敏 PII | 给出每个替换的精确字符坐标，可核对而不必信任 |
| `security/password-strength` | 密码强度 | 熵 + 对数域破解时间（不溢出）+ 模式检查 + 可复现生成 |
| `finance/amortization` | 等额本息 | 按「分」整数运算，三条恒等式自校验 |
| `finance/loans` | 房贷/车贷/提前还款/佣金 | PITI、还款模拟（含节省）、佣金分层拆分 |
| `text/readability` | 可读性 | Flesch / Flesch-Kincaid / Gunning Fog + 被动语态 + 长句定位 |
| `text/keyword-density` | 关键词密度 | 词频/密度/焦点词/2-gram，免疫原型链污染 |
| `text/writing` | 文案计数与占位文案 | 按用户感知字符计数（emoji 算 1 个）+ seeded lorem |
| `health/bmi` | BMI | WHO 分级 + 健康体重区间，不接收 age/gender |
| `health/body` | BAC 与围度分析 | Widmark 公式 + BMI/腰臀比/体型三项独立结果 |
| `weather/beaufort` | 蒲福风级 | GB/T 28591-2012 标准区间，修正飓风级低估 |
| `weather/comfort` | 体感温度 | 明确选了哪条公式、是否在适用区间内 |
| `units/craft` | 钩针/模型漆/甲油/染发 | 滴数守恒、线性混色、色阶提升分档 |
| `units/color-format` | 颜色格式 | HEX/RGB/HSL/HSV + WCAG 对比度，往返可逆 |
| `media/imaging` | 图片打印/音频体积 | 比例、DPI、裁切、各编码格式体积 |
| `business/metrics` | 民调/会议成本/小费/鱼缸 | 误差范围、机会成本、账单拆分、饲养密度与相容性 |
| `time/scheduling` | 日期/倒计时/徒步/阅读 | UTC 基准、月末钳制、显式 now |
| `religion` + `gaming` | 经文复习调度 / 谜题与曲线 | 间隔重复调度、seeded 谜题生成、法力曲线 |

## 作为 MCP server 接入

不需要安装任何依赖。把下面这段加进 MCP 客户端的配置（路径换成你的绝对路径）：

```json
{
  "mcpServers": {
    "yqztk-capabilities": {
      "command": "node",
      "args": ["E:/yuanqizhike-toolkit/packages/capabilities/bin/mcp-server.mjs"]
    }
  }
}
```

自检：

```bash
node bin/mcp-server.mjs --list     # 打印 38 个工具名后退出
node bin/mcp-server.mjs --help     # 使用说明
```

`--list` 之外，stdout 只会出现 JSON-RPC 消息（日志一律走 stderr）——这是 stdio 传输的硬要求，
混入一行日志就会让客户端解析失败。

## 与站点工具的差异（修正记录）

能力层是**修正版**，不是复刻。以下每一条都是读原实现时发现、并写了取证测试验证过的真实缺陷。
每条在对应源码头部的注释里都有编号（F1、F2…）。

### 安全类

| 来源工具 | 缺陷 | 本能力的处理 |
|---|---|---|
| `security-data-masker` | hash 模式 UI 标注 "SHA-256"，实现是 **32 位整数哈希**，可秒级暴力枚举 | 改用真 SHA-256，支持 salt |
| `weather-beaufort-wind-scale` | 高风段阈值偏离标准，**飓风级风速被低估一级**（60 mph 报 9，应为 10；80 mph 报 11，应为 12） | 以 GB/T 28591-2012 的 m/s 区间为权威 |

### 正确性类

| 来源工具 | 缺陷 | 本能力的处理 |
|---|---|---|
| `finance-amortization-schedule-generator` | 利率为 0 时 `if (!r) return` 返回空白；浮点累减致末期余额残留 | 支持 0%；按分整数运算 + 末期调整归零 |
| `marketing-keyword-density-checker` | `counts = {}` 遇 `constructor` / `toString` 会取到原型链函数，计数变 NaN 或函数源码 | 改用 `Map` |
| `ai-detection-readability-score` | 切句正则 `[^.!?]+[.!?]+(?=\s\|$)` 会**丢掉终止符之前的整段文字**，却仍算 1 句 | 改为按索引扫描，绝不丢片段 |
| `ai-detection-readability-score` | `\w+(ed\|en\|t\|wn\|ne\|de)` 让 `"is not"` 因 not 结尾是 t 被误判为被动 | 要求 ed/en 结尾或命中不规则分词表 |
| `real-mortgage-calculator` | 年度汇总用「月供×12×年数」估算期初余额（把利息当本金还） | 按真实逐期余额汇总 |
| `automotive-car-loan-payoff-calculator` | 模拟最多 600 期，超限时**无任何提示**，给出「正好 50 年还完」的错误结论 | 未收敛时返回 `converged:false` + 告警 |
| `utilities-date-calculator` | 用 `new Date(str+'T00:00:00')` 按本地时区解析，同一输入在不同时区结果不同 | 统一按 UTC 解析 |
| `utilities-date-calculator` | `setMonth` 溢出：1/31 + 1 月 = 3/3 | 钳制到目标月最后一天，并标记 `clamped` |
| `design-color-format-converter` | HSL 的 h 取整后再用于反算，往返转换丢精度 | 内部保留浮点 h，输出时才取整 |
| `photography-photo-print-resizer` | 像素不足时仍给出质量倍数，不说明口径 | 逐轴给出质量比与 sufficient/acceptable/insufficient 判定 |
| `audio-file-size-calculator` | 格式名按 `split('_')[1]` 取码率，拼错就静默落到 0 字节 | 显式格式表，未知格式抛错 |
| `pets-aquarium-stock-calculator` | 表面积写成 `gallons * 12`，使两法**恒等**，表面积法完全没起作用 | 保留体积法并在 warnings 明示该局限 |
| `news-polling-margin-calculator` | 总体默认 100 万并**始终**套用有限总体校正 | 不传 population 就不校正 |

### 确定性与隐私类

| 来源工具 | 缺陷 | 本能力的处理 |
|---|---|---|
| 三个生成器（lorem / password / escape-room） | 全篇 `Math.random()`，同一设置每次结果都不同，无法复现 | 一律要求显式 `seed` |
| 同上 | 洗牌用 `sort(() => Math.random() - 0.5)`，比较函数不满足传递性，分布有偏 | Fisher–Yates |
| `time-countdown-generator` 等 | 直接读 `Date.now()` 决定结果 | 要求显式传入 `now` |
| `religion-scripture-memory-tracker` | `Math.random()` 挑条目 + `Date.now()` 判断到期 | 显式 `now`；不传 seed 时按「最早到期优先」这一确定性策略排序 |
| `social-instagram-character-counter` | 用 `text.length` 计数，`'👍'.length === 2` 会**高估**字符数；emoji 范围只覆盖 4 个区块 | 按用户感知 grapheme 计数，emoji 用 `\p{Extended_Pictographic}` |
| `health-bmi-calculator` | 表单收集 age/gender，代码读完**从未使用** | 签名层面不接收这两个字段 |
| `marketing-keyword-density-checker` 等 | `replace(/[^\w\s]/g,'')` 会把非 ASCII 正文整体清空 | Unicode 分词 + 非拉丁占比告警 |
| `weather-apparent-temperature-calc` | 越界时悄悄换用另一条公式，返回值不说明用了哪条 | 返回 `method` 与 `applicability` |

### 一致性类

| 缺陷 | 本能力的处理 |
|---|---|
| 小费取整直接改写 total，明细与总额对不上 | 返回 `adjustment` 并计入 warnings；分摊之和恒等于总额 |
| 会议成本用固定常数折算「等价周数」，从输入推不出来 | 按输入年薪折算，并给出工时假设 |
| 模型漆滴数分别四舍五入，三部分之和可能不等于总滴数 | 最大余数法，`balanced` 恒为 true |
| 染色/打印等返回拼好的 HTML，无法机器处理 | 一律返回结构化对象 |

## 运行测试

```bash
cd packages/capabilities
node --test        # 注意：不要写 node --test test/，Node 22 会报 MODULE_NOT_FOUND
```

当前：**361 个测试，全部通过**。

## 测试有牙的证明（变异验证）

测试全绿不等于测试有效。以下变异都做过「注入错误 → 断言转红 → 按字节还原 → 转绿 → md5 比对」：

| 注入的变异 | 结果 |
|---|---|
| 去掉 `amortization` 里利息的分位取整 | 32 pass / **1 fail** |
| 把 `mask-pii` 的真 SHA-256 换回 32 位弱哈希 | 30 pass / **3 fail** |
| 在 `puzzles.mjs` 注入 `Math.random()` | **2 fail** |
| 在 `practice.mjs` 注入 `Date.now()` | **1 fail** |
| 在 `scheduling.mjs` 注入 `fetch(1)` | **1 fail** |
| 在 `color.mjs` 注入 `new XMLHttpRequest()` | **2 fail** |
| 把 `node:crypto` 换成 `lodash` | **2 fail** |

全部还原后 fail=0，且 md5 与变异前一致。变异注入器在 `.workbuddy/mutate.mjs`（本地工具，不入库）。

此外每个「修正项」都配了**取证测试**：复刻原实现的关键片段，断言它确实会出错。
这类测试的价值是——如果将来有人把实现改回旧写法，它会立刻转红。

## 下一步

1. 继续从 `.workbuddy/reports/tool-capability.json` 的 backlog 抽取
   （tier1 的 36 个 L1-pure 已全部完成；L1-file 4 个与全站剩余 L1-pure 356 个为后续）
2. 修复站点侧对应缺陷（清单见 `docs/站点工具缺陷待修_2026-10-09.md`）
3. 待收到 GSC 的真实展示数据后，用「有真实展示 × 可函数化」收敛出最终优先级
