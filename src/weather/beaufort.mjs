/**
 * capability: weather/beaufort
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/weather-beaufort-wind-scale
 * 版本：1.0.0
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 高风段阈值偏离标准，导致飓风级风速被低估一级。
 *        站点实现的分级阈值（mph）为 <1 / <4 / <8 / <13 / <19 / <25 / <32 /
 *        <40 / <50 / <62 / <74 / <84，其中 9–12 级的上界与标准表明显不符：
 *        · 60 mph 应为 Force 10（标准 55.2–63.3），站点报 Force 9
 *        · 70 mph 应为 Force 11（标准 64.4–72.5），站点报 Force 10
 *        · 80 mph 应为 Force 12（≥73.6），站点报 Force 11
 *        这是一个**与安全相关的**偏差：风速越高报得越低。
 *        本能力改用中国气象局 GB/T 28591-2012《风力等级》的 m/s 标准区间作为
 *        内部权威，其他单位先归一到 m/s 再分级（该标准与 WMO 表一致）。
 *   [F2] 站点只接受 4 种输入单位且不给出标准区间。本能力返回命中的区间边界
 *        （min/max，m/s 与输入单位双份），便于直接做判断或展示。
 *   [F3] 返回结构化对象而不是拼好的 HTML。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   12 个等级的英文名称与描述文字、单位换算系数（km/h 0.621371、m/s 2.23694、
 *   knots 1.15078 与本站等价）、以及「按用户输入单位回显 + 附 mph 折算」的展示口径。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 不同来源的 Beaufort 表在边界上存在 1 个单位的出入（knots / mph / m/s 三套
 *        换算不完全自洽）。本实现统一以 GB/T 28591-2012 的 m/s 区间为准。
 *   [L2] 只处理风速，不含阵风、持续风速时长、海拔修正等气象要素。
 */

export const CAPABILITY = Object.freeze({
  id: 'weather/beaufort',
  version: '1.0.0',
  sourceTool: 'weather-beaufort-wind-scale',
  deterministic: true,
  networkAccess: false,
  standard: 'GB/T 28591-2012 风力等级（与 WMO 表一致）',
});

/** 单位 → m/s 的换算系数 */
const TO_MS = {
  ms: 1,
  kmh: 1 / 3.6,
  mph: 0.44704,
  knots: 0.514444,
};

/** GB/T 28591-2012 风力等级（以 m/s 为标准单位）。upper 为该级上界（不含）。 */
const SCALE = [
  { force: 0, lower: 0.0, upper: 0.3, name: 'Calm', zh: '无风', desc: 'Smoke rises vertically.' },
  { force: 1, lower: 0.3, upper: 1.6, name: 'Light air', zh: '软风', desc: 'Wind direction shown by smoke drift.' },
  { force: 2, lower: 1.6, upper: 3.4, name: 'Light breeze', zh: '轻风', desc: 'Leaves rustle, wind felt on face.' },
  { force: 3, lower: 3.4, upper: 5.5, name: 'Gentle breeze', zh: '微风', desc: 'Leaves and small twigs in constant motion.' },
  { force: 4, lower: 5.5, upper: 8.0, name: 'Moderate breeze', zh: '和风', desc: 'Small trees sway. Dust and paper raised.' },
  { force: 5, lower: 8.0, upper: 10.8, name: 'Fresh breeze', zh: '清劲风', desc: 'Small trees in leaf begin to sway.' },
  { force: 6, lower: 10.8, upper: 13.9, name: 'Strong breeze', zh: '强风', desc: 'Large branches move. Whistling in wires.' },
  { force: 7, lower: 13.9, upper: 17.2, name: 'High wind', zh: '疾风', desc: 'Whole trees swaying. Resistance felt walking.' },
  { force: 8, lower: 17.2, upper: 20.8, name: 'Gale', zh: '大风', desc: 'Small branches broken. Difficulty walking forward.' },
  { force: 9, lower: 20.8, upper: 24.5, name: 'Strong gale', zh: '烈风', desc: 'Structural damage possible. Chimneys and tiles removed.' },
  { force: 10, lower: 24.5, upper: 28.5, name: 'Storm', zh: '狂风', desc: 'Trees uprooted. Significant structural damage.' },
  { force: 11, lower: 28.5, upper: 32.7, name: 'Violent storm', zh: '暴风', desc: 'Widespread damage. Few buildings remain standing.' },
  { force: 12, lower: 32.7, upper: Infinity, name: 'Hurricane', zh: '台风/飓风', desc: 'Devastation. Air full of foam. Visibility nearly zero.' },
];

/** 纯函数：从 m/s 得到风力等级条目。 */
export function beaufortFromMetersPerSecond(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) throw new RangeError('风速必须是非负有限数值（m/s）');
  return SCALE.find((s) => v < s.upper) || SCALE[SCALE.length - 1];
}

/**
 * 从任意支持单位计算风力等级。
 *
 * @param {number} speed 风速
 * @param {'mph'|'kmh'|'ms'|'knots'} [unit='mph']
 * @returns {object} 结构化结果，含 level 明细与区间边界
 */
export function beaufortFromSpeed(speed, unit = 'mph') {
  if (!(unit in TO_MS)) throw new RangeError(`unit 只能是 ${Object.keys(TO_MS).join(' / ')}`);
  const s = Number(speed);
  if (!Number.isFinite(s)) throw new RangeError('风速必须是有限数值');
  if (s < 0) throw new RangeError('风速不能为负');

  const ms = s * TO_MS[unit];
  const level = beaufortFromMetersPerSecond(ms);
  const perUnit = 1 / TO_MS[unit];
  const round1 = (x) => Math.round(x * 10) / 10;
  const round2 = (x) => Math.round(x * 100) / 100;

  return {
    force: level.force,
    name: level.name,
    nameZh: level.zh,
    description: level.desc,
    input: { speed: s, unit },
    metersPerSecond: round2(ms),
    mph: round2(ms / TO_MS.mph),
    kmh: round2(ms * 3.6),
    knots: round2(ms / TO_MS.knots),
    rangeInInputUnit: {
      lower: round1(level.lower * perUnit),
      // 本级上界为「不含」，展示时给到该值，便于表达 [lower, upper) 语义
      upperExclusive: level.upper === Infinity ? null : round1(level.upper * perUnit),
      unit,
    },
    /** 与站点工具一致的释义：包含 12 级完整对照表 */
    reference: SCALE.map((x) => ({
      force: x.force,
      name: x.name,
      msRange: [x.lower, x.upper === Infinity ? null : x.upper],
    })),
    warnings:
      level.force === 12
        ? ['已达最高等级（12 级）—— 12 级及以上不再细分，实际风速可能远高于下界']
        : [],
  };
}
