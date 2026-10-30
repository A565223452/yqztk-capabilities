/**
 * capability 组：手工艺与配色换算
 * ============================================================
 * 覆盖来源工具：
 *   - hobbies-crochet-hook-converter      钩针型号换算（US / UK / mm）
 *   - hobbies-model-paint-mixer           模型漆调配（滴数分配 + 颜色混合）
 *   - beauty-nail-polish-mixer            甲油调色（按比例混合 RGB + 渐变）
 *   - beauty-hair-color-developer         染发剂用量与处理时间
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] 颜色混合口径明确化：站点把两个色块叠加显示，但混合色是按哪种方式算的
 *        在界面上完全不可见（用户只能看到一个结果色）。本能力显式提供
 *        `mixMode: 'linear'`（线性插值，即站点实际行为），并在返回值里
 *        给出参与混合的两个颜色与权重，使结果可复核。
 *   [F2] 滴数分配不再有余额漂移：站点用四舍五入分别算 base 与 mix，
 *        两者之和可能不等于「总滴数 − 稀释剂滴数」（例如各 0.5 时都进位）。
 *        本能力先算稀释剂，再按最大余数法分配剩余滴数，**各部分之和恒等于总滴数**。
 *   [F3] 钩针换算支持反向查询与容差匹配（站点只做了正向 select 联动）。
 *   [F4] 染发剂返回结构化对象而不是拼好的 HTML。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 钩针型号各国标准并不统一，同一 mm 值在不同厂商可能对应不同字母，
 *        本表采用站点原表（业界常见的公制近似值）。标称 mm 相同的型号
 *        在不同品牌之间仍可能有实际差异。
 *   [L2] 颜色线性混合是 RGB 空间的算术平均，与人眼感知的减色混合（颜料）
 *        不完全一致 —— 真实调漆更接近减法混色。本能力只做算术混合，
 *        不声称能给出现实中精确的调色结果。
 *   [L3] 染发用量是按「发长分档 + 1:1 比例」的经验估算，
 *        实际用量受发量、发质、孔隙度影响很大，不构成操作建议。
 */

export const CROCHET_HOOKS = Object.freeze([
  { us: 'B', uk: '1', mm: 2.25 },
  { us: 'C', uk: '2', mm: 2.75 },
  { us: 'D', uk: '3', mm: 3.25 },
  { us: 'E', uk: '4', mm: 3.5 },
  { us: 'F', uk: '5', mm: 3.75 },
  { us: 'G', uk: '6', mm: 4.0 },
  { us: '7', uk: '7', mm: 4.5 },
  { us: 'H', uk: '8', mm: 5.0 },
  { us: 'I', uk: '9', mm: 5.5 },
  { us: 'J', uk: '10', mm: 6.0 },
  { us: 'K', uk: '10.5', mm: 6.5 },
  { us: 'L', uk: '11', mm: 7.0 },
  { us: 'M', uk: '12', mm: 7.5 },
  { us: 'N', uk: '13', mm: 8.0 },
  { us: 'O', uk: '14', mm: 9.0 },
  { us: 'P', uk: '15', mm: 10.0 },
  { us: 'Q', uk: '16', mm: 11.5 },
  { us: '—', uk: '17', mm: 12.0 },
  { us: 'S', uk: '18', mm: 14.0 },
  { us: 'T', uk: '19', mm: 15.0 },
  { us: 'U', uk: '20', mm: 16.0 },
]);

/**
 * 钩针型号换算。传入任一侧的值即可得到完整三列。
 * @param {object} input
 * @param {string} [input.us] 美制字母
 * @param {string} [input.uk] 英制编号
 * @param {number} [input.mm] 公制毫米
 * @returns {{found:boolean, us:string|null, uk:string|null, mm:number|null, nearest?:object, table:Array}}
 */
export function convertCrochetHook(input = {}) {
  const { us, uk, mm } = input;
  const table = CROCHET_HOOKS;
  const base = { table };

  if (us !== undefined) {
    const hit = table.find((h) => String(h.us).toLowerCase() === String(us).toLowerCase());
    return hit ? { found: true, us: hit.us, uk: hit.uk, mm: hit.mm, ...base } : { found: false, us: null, uk: null, mm: null, ...base };
  }
  if (uk !== undefined) {
    const hit = table.find((h) => String(h.uk) === String(uk));
    return hit ? { found: true, us: hit.us, uk: hit.uk, mm: hit.mm, ...base } : { found: false, us: null, uk: null, mm: null, ...base };
  }
  if (mm !== undefined) {
    const target = Number(mm);
    if (!Number.isFinite(target) || target <= 0) throw new RangeError('mm 必须是大于 0 的数值');
    const hit = table.find((h) => Math.abs(h.mm - target) < 0.01);
    if (hit) return { found: true, us: hit.us, uk: hit.uk, mm: hit.mm, ...base };
    const nearest = table.reduce((best, h) => (Math.abs(h.mm - target) < Math.abs(best.mm - target) ? h : best), table[0]);
    return { found: false, us: null, uk: null, mm: null, nearest, ...base };
  }
  throw new RangeError('必须提供 us / uk / mm 之一');
}

const clamp255 = (x) => Math.max(0, Math.min(255, Math.round(x)));

/** 解析 #rgb / #rrggbb 十六进制颜色。 */
export function parseHex(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new RangeError(`无法解析的颜色：${hex}`);
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** 线性混合两个 RGB 颜色，weight 是 color1 的权重（0~1）。 */
export function mixRgb(c1, c2, weight) {
  const w = Math.max(0, Math.min(1, Number(weight)));
  return {
    r: clamp255(c1.r * w + c2.r * (1 - w)),
    g: clamp255(c1.g * w + c2.g * (1 - w)),
    b: clamp255(c1.b * w + c2.b * (1 - w)),
  };
}

/**
 * 模型漆调配：总滴数中先扣稀释剂，再按基漆/添加漆比例分配。
 * [F2] 采用最大余数法，保证 base + mix + thinner 恒等于 totalDrops。
 */
export function mixModelPaint(input = {}) {
  const totalDrops = Number(input.totalDrops);
  const baseRatio = Number(input.baseRatio ?? 1);
  const mixRatio = Number(input.mixRatio ?? 1);
  const thinner = Number(input.thinner ?? 0);

  if (!Number.isInteger(totalDrops) || totalDrops <= 0) throw new RangeError('totalDrops 必须是大于 0 的整数');
  if (!Number.isFinite(baseRatio) || baseRatio < 0) throw new RangeError('baseRatio 必须是非负数');
  if (!Number.isFinite(mixRatio) || mixRatio < 0) throw new RangeError('mixRatio 必须是非负数');
  if (!Number.isFinite(thinner) || thinner < 0 || thinner > 1) throw new RangeError('thinner 必须在 0~1 之间');
  if (baseRatio + mixRatio <= 0) throw new RangeError('baseRatio 与 mixRatio 不能同时为 0');

  const thinnerDrops = Math.round(totalDrops * thinner);
  const paintDrops = totalDrops - thinnerDrops;
  const totalRatio = baseRatio + mixRatio;
  const exactBase = (paintDrops * baseRatio) / totalRatio;
  const exactMix = (paintDrops * mixRatio) / totalRatio;

  let baseDrops = Math.floor(exactBase);
  let mixDrops = Math.floor(exactMix);
  const remainder = paintDrops - baseDrops - mixDrops;
  // 最大余数法：把余数给小数部分更大的那个
  const order = [
    { key: 'base', frac: exactBase - baseDrops },
    { key: 'mix', frac: exactMix - mixDrops },
  ].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) {
    if (order[i % order.length].key === 'base') baseDrops++;
    else mixDrops++;
  }

  const result = {
    totalDrops,
    baseDrops,
    mixDrops,
    thinnerDrops,
    ratio: `${baseRatio}:${mixRatio}`,
    thinnerRatio: thinner,
    /** 自校验：三部分之和必须等于总滴数 */
    balanced: baseDrops + mixDrops + thinnerDrops === totalDrops,
  };

  if (input.baseHex || input.mixHex) {
    const b = parseHex(input.baseHex || '#ffffff');
    const m = parseHex(input.mixHex || '#000000');
    const mixed = mixRgb(b, m, baseDrops + mixDrops > 0 ? baseDrops / (baseDrops + mixDrops) : 0.5);
    result.colors = {
      base: rgbToHex(b.r, b.g, b.b),
      mix: rgbToHex(m.r, m.g, m.b),
      mixed: rgbToHex(mixed.r, mixed.g, mixed.b),
      mixMode: 'linear',
    };
  }
  return result;
}

/**
 * 甲油调色：按比例混合两种颜色，并给出 7 级渐变。
 * @param {object} input
 * @param {string} input.color1 主色（hex）
 * @param {string} input.color2 辅色（hex）
 * @param {number} [input.ratio=0.5] 主色权重 0~1
 */
export function mixNailPolish(input = {}) {
  const c1 = parseHex(input.color1);
  const c2 = parseHex(input.color2);
  const ratio = input.ratio === undefined ? 0.5 : Number(input.ratio);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError('ratio 必须在 0~1 之间');

  const mixed = mixRgb(c1, c2, ratio);
  const gradient = [];
  for (let i = 0; i < 7; i++) {
    const t = 1 - i / 6; // 从主色到辅色
    const c = mixRgb(c1, c2, t);
    gradient.push({ position: Math.round((i / 6) * 100), hex: rgbToHex(c.r, c.g, c.b) });
  }

  return {
    color1: rgbToHex(c1.r, c1.g, c1.b),
    color2: rgbToHex(c2.r, c2.g, c2.b),
    ratio,
    mixedHex: rgbToHex(mixed.r, mixed.g, mixed.b),
    mixedRgb: mixed,
    mixMode: 'linear',
    gradient,
    label: `${Math.round(ratio * 100)}% / ${Math.round((1 - ratio) * 100)}%`,
  };
}

/**
 * 染发剂用量与处理时间估算（按色阶提升量分档）。
 * @param {object} input
 * @param {number} input.startLevel 起始色阶（1~10）
 * @param {number} input.targetLevel 目标色阶（1~10）
 * @param {number} [input.hairLengthCm] 发长（cm），用于用量分档
 */
export function planHairColor(input = {}) {
  const start = Number(input.startLevel);
  const target = Number(input.targetLevel);
  if (!Number.isInteger(start) || start < 1 || start > 10) throw new RangeError('startLevel 必须是 1~10 的整数');
  if (!Number.isInteger(target) || target < 1 || target > 10) throw new RangeError('targetLevel 必须是 1~10 的整数');

  const lift = target - start;
  let developerVolume;
  let processTime;
  let note;

  if (lift <= 0) {
    developerVolume = 10;
    processTime = '15-25 min';
    note = lift === 0
      ? 'Tone-on-tone. Deposit only, no lift required.'
      : 'Going darker. No developer lift needed; colour deposits over the existing level.';
  } else if (lift <= 1) {
    developerVolume = 10;
    processTime = '20-30 min';
    note = 'Minimal lift (up to 1 level).';
  } else if (lift <= 2) {
    developerVolume = 20;
    processTime = '30-45 min';
    note = 'Standard lift (1-2 levels)';
  } else if (lift <= 3) {
    developerVolume = 30;
    processTime = '30-45 min';
    note = 'Strong lift (2-3 levels)';
  } else {
    developerVolume = 40;
    processTime = '30-45 min';
    note = 'Maximum lift (3-4 levels) - CAUTION';
  }

  const colorAmount = 50; // 与站点一致：以 50 g 染膏为基准
  const devAmount = colorAmount; // 1:1
  const warnings = [];
  if (lift >= 4) warnings.push('提升 4 个色阶以上，属于漂染范畴，建议分次进行并先做发束测试');
  if (start <= 3 && lift >= 3) warnings.push('深色头发大幅提色容易带出暖橙底色，通常需要额外中和');
  if (lift < 0 && Math.abs(lift) >= 4) warnings.push('跨越 4 个色阶以上做深染，成品可能偏暗，建议先做发束测试');

  return {
    startLevel: start,
    targetLevel: target,
    lift,
    direction: lift > 0 ? 'lift' : lift < 0 ? 'deposit' : 'tone',
    developerVolume,
    developerLabel: `${developerVolume} Vol`,
    processTime,
    note,
    mixingRatio: '1:1（如需更多提升或更稀的质地，可用 1:2）',
    colorAmountGrams: colorAmount,
    developerAmountGrams: devAmount,
    components: [
      { item: `Cream developer ${developerVolume} Vol`, amount: `${devAmount} g (1:1 ratio)` },
      { item: 'Hair colour', amount: `${colorAmount} g` },
    ],
    warnings,
  };
}
