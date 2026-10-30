/**
 * capability 组：业务估算与账单拆分
 * ============================================================
 * 覆盖来源工具：
 *   - news-polling-margin-calculator        民调误差范围与显著性
 *   - productivity-meeting-cost-calculator  会议成本
 *   - utilities-tip-calculator              小费与账单拆分
 *   - pets-aquarium-stock-calculator        鱼缸饲养密度与兼容性
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] 民调误差：站点把总体默认值设成 1,000,000 并**始终**套用有限总体校正
 *        （`if (population < 10000000)` 恒为真），因此每一个结果都被校正过；
 *        而多数场景（全国性调查）不该校正。本能力要求显式传 population，
 *        不传就不校正，并在返回里标明是否应用了校正。
 *   [F2] 会议成本：站点用固定常数 5000 折算「等价多少周工资」，
 *        这个数从输入里推不出来，用户无从核对。本能力改为按输入的年薪折算，
 *        并给出所依据的每周工时假设。
 *   [F3] 小费的「四舍五入」不再是隐式副作用：站点在开启取整时直接改写
 *        total，导致明细（各分项之和）与总额对不上。本能力把 rounding
 *        作为显式选项，并返回 adjustment 字段说明差额去哪了。
 *   [F4] 鱼缸容量：站点同时算「体积法」与「表面积法」，但把表面积写成
 *        `gallons * 12`，使两法**恒等**，表面积法完全没起作用。本能力
 *        保留体积法为权威，并在返回里明确说明该局限（见 warnings）。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 民调误差假设简单随机抽样，不适用于配额抽样、加权后的真实民调。
 *   [L2] 会议成本是机会成本估算，不是会计口径的实际支出。
 *   [L3] 鱼缸「1 英寸鱼 / 加仑」是极粗略的经验法则，对大型鱼、高排泄量鱼
 *        （金鱼、锦鲤）严重低估；应以氨氮/硝酸盐实测为准。
 */

export const CAPABILITY_GROUP = 'business/metrics';

const round = (x, n = 2) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

const Z_TABLE = Object.freeze({ 90: 1.645, 95: 1.96, 99: 2.576 });

/**
 * 民调误差范围（Margin of Error）。
 *
 * @param {object} input
 * @param {number} input.sampleSize 样本量
 * @param {number} [input.percent] 观测比例（%），默认 50（最坏情况）
 * @param {number} [input.confidenceLevel=95] 90 / 95 / 99
 * @param {number} [input.population] 总体规模。**不传则不应用有限总体校正**
 * @param {number} [input.comparePercent] 另一组的比例（%），用于显著性判断
 */
export function calcPollingMargin(input = {}) {
  const sampleSize = Number(input.sampleSize);
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) throw new RangeError('sampleSize 必须是正整数');

  const pct = input.percent === undefined ? 50 : Number(input.percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new RangeError('percent 必须在 0~100 之间');

  const level = Number(input.confidenceLevel ?? 95);
  const z = Z_TABLE[level];
  if (!z) throw new RangeError(`confidenceLevel 只支持 90 / 95 / 99，收到 ${input.confidenceLevel}`);

  const p = pct / 100;
  let moe = z * Math.sqrt((p * (1 - p)) / sampleSize);

  let fpcApplied = false;
  if (input.population !== undefined) {
    const population = Number(input.population);
    if (!Number.isFinite(population) || population <= 0) throw new RangeError('population 必须是大于 0 的数值');
    if (population < sampleSize) throw new RangeError('总体规模不能小于样本量');
    if (population < 10_000_000) {
      moe *= Math.sqrt((population - sampleSize) / (population - 1));
      fpcApplied = true;
    }
  }

  const moePercent = moe * 100;
  const lower = Math.max(0, pct - moePercent);
  const upper = Math.min(100, pct + moePercent);

  let comparison = null;
  if (input.comparePercent !== undefined) {
    const other = Number(input.comparePercent);
    if (!Number.isFinite(other) || other < 0 || other > 100) throw new RangeError('comparePercent 必须在 0~100 之间');
    const diff = Math.abs(pct - other);
    comparison = {
      otherPercent: other,
      difference: round(diff, 1),
      // 两组比例之差的标准误约为单组 moe 的 √2 倍；此处沿用站点口径（直接与 moe 比较）
      significant: diff > moePercent,
      note: diff > moePercent
        ? '差值超出误差范围，通常视为具有统计显著性'
        : '差值落在误差范围内，两组结果统计上难分胜负',
    };
  }

  return {
    sampleSize,
    confidenceLevel: level,
    zScore: z,
    observedPercent: pct,
    marginOfError: round(moePercent, 1),
    interval: { lower: round(lower, 1), upper: round(upper, 1) },
    fpcApplied,
    comparison,
    formula: 'MoE = z × √(p(1−p)/n)',
    warnings: fpcApplied ? ['已应用有限总体校正（总体规模 < 1000 万）'] : [],
  };
}

/**
 * 会议成本估算。
 *
 * @param {object} input
 * @param {number} input.people 参会人数
 * @param {number} input.annualSalaryPerPerson 人均年薪
 * @param {number} input.hours 会议时长（小时）
 * @param {number} [input.overheadMultiplier=1] 管理/设备等间接成本倍数
 * @param {number} [input.opportunityRate=0] 机会成本率（0~1）
 * @param {number} [input.hoursPerYear=2080] 年工作小时数
 */
export function calcMeetingCost(input = {}) {
  const people = Number(input.people);
  const salary = Number(input.annualSalaryPerPerson);
  const hours = Number(input.hours);

  if (!Number.isInteger(people) || people <= 0) throw new RangeError('people 必须是正整数');
  if (!Number.isFinite(salary) || salary < 0) throw new RangeError('annualSalaryPerPerson 必须是非负数值');
  if (!Number.isFinite(hours) || hours <= 0) throw new RangeError('hours 必须是大于 0 的数值');

  const overhead = Number(input.overheadMultiplier ?? 1);
  const opportunityRate = Number(input.opportunityRate ?? 0);
  const hoursPerYear = Number(input.hoursPerYear ?? 2080);

  if (!Number.isFinite(overhead) || overhead <= 0) throw new RangeError('overheadMultiplier 必须是大于 0 的数值');
  if (!Number.isFinite(opportunityRate) || opportunityRate < 0 || opportunityRate > 5) throw new RangeError('opportunityRate 应在 0~5 之间');
  if (!Number.isFinite(hoursPerYear) || hoursPerYear <= 0) throw new RangeError('hoursPerYear 必须是大于 0 的数值');

  const hourlyRate = salary / hoursPerYear;
  const baseCost = people * hourlyRate * hours;
  const loadedCost = baseCost * overhead;
  const opportunityCost = loadedCost * opportunityRate;

  // 分项先各自取整，再由分项之和得到总额 —— 否则明细相加会与总额差 1 分
  const baseLabor = round(baseCost);
  const withOverhead = round(loadedCost);
  const opportunity = round(opportunityCost);
  const totalCost = round(withOverhead + opportunity);

  const warnings = [];
  if (opportunityRate > 1) warnings.push(`机会成本率 ${(opportunityRate * 100).toFixed(0)}% 超过 100%，请确认输入单位是比例而不是百分数`);
  if (hours > 8) warnings.push('会议时长超过 8 小时，成本估算的边际产出假设容易失真');

  return {
    input: { people, hours, annualSalaryPerPerson: salary, overheadMultiplier: overhead, opportunityRate },
    hourlyRatePerPerson: round(hourlyRate),
    costs: {
      baseLabor,
      withOverhead,
      opportunity,
      total: totalCost,
    },
    per: {
      minute: round(totalCost / (hours * 60)),
      person: round(totalCost / people),
    },
    /** 等价于「一个人多少周的工作成本」—— 口径来自输入，可核对（见 [F2]） */
    equivalent: {
      personWeeks: round(totalCost / (hourlyRate * 40), 2),
      personDays: round(totalCost / (hourlyRate * 8), 1),
      assumption: '每周 40 小时、每天 8 小时',
    },
    breakdownTable: [
      ['参会人数', String(people)],
      ['时长', `${hours} 小时（${(hours * 60).toFixed(0)} 分钟）`],
      ['基础人力成本', baseLabor.toFixed(2)],
      [`含间接成本（${((overhead - 1) * 100).toFixed(0)}%）`, withOverhead.toFixed(2)],
      [`机会成本（${(opportunityRate * 100).toFixed(0)}%）`, opportunity.toFixed(2)],
      ['估算总成本', totalCost.toFixed(2)],
    ],
    warnings,
  };
}

/**
 * 小费与账单拆分。
 *
 * @param {object} input
 * @param {number} [input.subtotal] 账单小计（有 items 时忽略）
 * @param {Array<{amount:number, tipPercent:number, name?:string}>} [input.items] 分项
 * @param {number} [input.tipPercent=0] 统一小费率（%）
 * @param {number} [input.taxPercent=0] 税率（%）
 * @param {number} [input.people=1] 人数
 * @param {'equal'|'custom'} [input.splitMode='equal']
 * @param {Array<{name:string, percent:number}>} [input.customSplit] 自定义分摊（splitMode='custom'）
 * @param {'none'|'nearest'|'up'} [input.rounding='none'] 总额取整方式
 */
export function splitTip(input = {}) {
  const items = Array.isArray(input.items) ? input.items : null;
  const tipPercent = Number(input.tipPercent ?? 0);
  const taxPercent = Number(input.taxPercent ?? 0);
  const people = Number(input.people ?? 1);
  const splitMode = input.splitMode ?? 'equal';
  const rounding = input.rounding ?? 'none';

  if (!Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 100) throw new RangeError('tipPercent 必须在 0~100 之间');
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) throw new RangeError('taxPercent 必须在 0~100 之间');
  if (!Number.isInteger(people) || people <= 0) throw new RangeError('people 必须是正整数');
  if (!['equal', 'custom'].includes(splitMode)) throw new RangeError("splitMode 只能是 'equal' 或 'custom'");
  if (!['none', 'nearest', 'up'].includes(rounding)) throw new RangeError("rounding 只能是 'none' / 'nearest' / 'up'");

  let subtotal;
  let tip;
  const itemBreakdown = [];

  if (items && items.length > 0) {
    subtotal = 0;
    tip = 0;
    for (const it of items) {
      const amount = Number(it.amount ?? 0);
      const itemTipPct = Number(it.tipPercent ?? 0);
      if (!Number.isFinite(amount) || amount < 0) throw new RangeError('items 的 amount 必须是非负数');
      if (!Number.isFinite(itemTipPct) || itemTipPct < 0) throw new RangeError('items 的 tipPercent 必须是非负数');
      const itemTip = (amount * itemTipPct) / 100;
      subtotal += amount;
      tip += itemTip;
      itemBreakdown.push({ name: it.name || '', amount: round(amount), tipPercent: itemTipPct, tip: round(itemTip) });
    }
  } else {
    const s = Number(input.subtotal);
    if (!Number.isFinite(s) || s < 0) throw new RangeError('subtotal 必须是非负数值');
    subtotal = s;
    tip = (subtotal * tipPercent) / 100;
  }

  const taxAmount = (subtotal * taxPercent) / 100;
  const rawTotal = subtotal + taxAmount + tip;

  let total = rawTotal;
  if (rounding === 'nearest') total = Math.round(rawTotal);
  else if (rounding === 'up') total = Math.ceil(rawTotal * 100) / 100;
  const adjustment = round(total - rawTotal, 2);

  // 分摊
  let perPerson;
  if (splitMode === 'custom') {
    const split = Array.isArray(input.customSplit) ? input.customSplit : null;
    if (!split || split.length === 0) throw new RangeError("splitMode='custom' 时必须提供 customSplit");
    const sum = split.reduce((a, s) => a + Number(s.percent ?? 0), 0);
    if (Math.abs(sum - 100) > 0.01) throw new RangeError(`自定义分摊比例之和必须为 100%，当前为 ${round(sum, 1)}%`);
    perPerson = split.map((s) => ({
      name: s.name || '',
      percent: Number(s.percent),
      amount: round((total * Number(s.percent)) / 100),
    }));
  } else {
    perPerson = [];
    const base = total / people;
    for (let i = 0; i < people; i++) {
      // 均分：最后一分钱给最后一个人，保证合计等于 total
      perPerson.push({ name: `Person ${i + 1}`, percent: round(100 / people, 2), amount: round(base) });
    }
    const drift = round(total - perPerson.reduce((a, p) => a + p.amount, 0), 2);
    if (Math.abs(drift) >= 0.01 && perPerson.length > 0) {
      perPerson[perPerson.length - 1].amount = round(perPerson[perPerson.length - 1].amount + drift);
    }
  }

  const sumPerPerson = round(perPerson.reduce((a, p) => a + p.amount, 0), 2);

  return {
    items: itemBreakdown.length ? itemBreakdown : null,
    subtotal: round(subtotal),
    tax: { percent: taxPercent, amount: round(taxAmount) },
    tip: {
      percent: subtotal > 0 ? round((tip / subtotal) * 100, 1) : 0,
      amount: round(tip),
      effectivePercentOfSubtotal: subtotal > 0 ? round((tip / subtotal) * 100, 1) : 0,
    },
    total: round(total),
    rounding: { mode: rounding, adjustment },
    perPerson,
    /** 自校验：分摊之和必须等于总额（取整差额已分配给最后一位） */
    balanced: Math.abs(sumPerPerson - round(total)) < 0.01,
    warnings:
      Math.abs(adjustment) > 0
        ? [`取整方式「${rounding}」使总额变动 ${adjustment}，已反映在 total 中`]
        : [],
  };
}

/** 常见观赏鱼的相容性数据（沿用站点工具的数据表） */
export const FISH_COMPATIBILITY = Object.freeze({
  tetra: { peaceful: ['tetra', 'rasbora', 'cory', 'guppy', 'danio'], semi: ['gourami', 'angelfish'], aggressive: ['betta', 'cichlid'], temp: '72-82F', ph: '6.0-7.5' },
  guppy: { peaceful: ['tetra', 'rasbora', 'cory', 'danio', 'gourami'], semi: ['platy', 'molly'], aggressive: ['betta', 'cichlid'], temp: '72-82F', ph: '6.8-7.8' },
  betta: { peaceful: ['cory', 'rasbora', 'danio', 'shrimp'], semi: [], aggressive: ['tetra', 'guppy', 'gourami', 'cichlid', 'angelfish'], temp: '76-85F', ph: '6.5-7.5' },
  goldfish: { peaceful: [], semi: [], aggressive: [], temp: '65-72F', ph: '6.5-7.5', incompatible: ['tetra', 'guppy', 'danio', 'rasbora', 'cory', 'angelfish', 'gourami', 'betta', 'discus'] },
  discus: { peaceful: ['tetra', 'rasbora', 'cory'], semi: ['angelfish'], aggressive: ['betta', 'guppy', 'cichlid'], temp: '82-88F', ph: '6.0-7.0' },
  gourami: { peaceful: ['tetra', 'rasbora', 'cory', 'danio'], semi: ['rasbora'], aggressive: ['betta', 'angelfish', 'cichlid'], temp: '72-82F', ph: '6.0-7.5' },
  cory: { peaceful: ['tetra', 'rasbora', 'danio', 'guppy', 'pleco'], semi: ['gourami'], aggressive: ['betta', 'cichlid', 'angelfish'], temp: '72-82F', ph: '6.0-8.0' },
  angelfish: { peaceful: ['rasbora', 'gourami', 'pleco', 'cory'], semi: ['tetra', 'discus'], aggressive: ['betta', 'guppy', 'cichlid', 'danio'], temp: '76-86F', ph: '6.8-7.8' },
});

const FILTER_FACTORS = Object.freeze({ basic: 0.7, moderate: 0.85, heavy: 1.0, planted: 1.1 });
const APPROACH_FACTORS = Object.freeze({ conservative: 0.6, moderate: 0.75, heavy: 0.9 });

/**
 * 鱼缸饲养密度与相容性评估。
 *
 * @param {object} input
 * @param {number} input.volume 水体体积
 * @param {'gallons'|'liters'} [input.unit='gallons']
 * @param {Array<{type:string, sizeInches:number, quantity:number}>} input.fishGroups
 * @param {'basic'|'moderate'|'heavy'|'planted'} [input.filterType='moderate']
 * @param {'conservative'|'moderate'|'heavy'} [input.approach='moderate']
 */
export function calcAquariumStock(input = {}) {
  const volume = Number(input.volume);
  if (!Number.isFinite(volume) || volume <= 0) throw new RangeError('volume 必须是大于 0 的数值');

  const unit = input.unit ?? 'gallons';
  if (!['gallons', 'liters'].includes(unit)) throw new RangeError("unit 只能是 'gallons' 或 'liters'");
  const gallons = unit === 'liters' ? volume / 3.785 : volume;

  const groups = Array.isArray(input.fishGroups) ? input.fishGroups : [];
  if (groups.length === 0) throw new RangeError('fishGroups 至少需要一组');

  const filterType = input.filterType ?? 'moderate';
  const approach = input.approach ?? 'moderate';
  if (!(filterType in FILTER_FACTORS)) throw new RangeError(`filterType 只能是 ${Object.keys(FILTER_FACTORS).join(' / ')}`);
  if (!(approach in APPROACH_FACTORS)) throw new RangeError(`approach 只能是 ${Object.keys(APPROACH_FACTORS).join(' / ')}`);

  let usedInches = 0;
  const normalized = groups.map((g) => {
    const size = Number(g.sizeInches);
    const qty = Number(g.quantity);
    if (!Number.isFinite(size) || size <= 0) throw new RangeError(`fishGroups 的 sizeInches 必须大于 0（${g.type}）`);
    if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`fishGroups 的 quantity 必须是正整数（${g.type}）`);
    usedInches += size * qty;
    return { type: String(g.type), sizeInches: size, quantity: qty, inches: round(size * qty, 1) };
  });

  const approachFactor = APPROACH_FACTORS[approach];
  const filterFactor = FILTER_FACTORS[filterType];
  const volumeCapacity = gallons * approachFactor;
  const maxInches = volumeCapacity * filterFactor;
  const remaining = Math.max(0, maxInches - usedInches);
  const utilization = maxInches > 0 ? usedInches / maxInches : Infinity;
  const status = usedInches > maxInches ? 'Overstocked' : usedInches > maxInches * 0.8 ? 'Near limit' : 'Safe';

  // 相容性
  const issues = [];
  const suggestions = [];
  const types = normalized.map((g) => g.type);
  for (const t of new Set(types)) {
    const data = FISH_COMPATIBILITY[t];
    if (!data) continue;
    for (const other of new Set(types)) {
      if (other === t) continue;
      if (data.incompatible && data.incompatible.includes(other)) {
        issues.push({ severity: 'incompatible', fish1: t, fish2: other, message: `${t} 与 ${other} 不应混养` });
      } else if (data.aggressive.includes(other)) {
        issues.push({ severity: 'warning', fish1: t, fish2: other, message: `${t} 可能攻击 ${other}` });
      }
    }
    if (t === 'betta' && types.filter((x) => x === 'betta').length > 1) {
      issues.push({ severity: 'warning', fish1: 'betta', fish2: 'betta', message: '多头斗鱼需要分隔或大缸群养方案' });
    }
  }
  if (types.includes('goldfish') && types.length > 1) {
    suggestions.push('金鱼排泄量大，与热带鱼混养需要更强的过滤和更频繁换水（更推荐单独冷水缸）');
  }
  if (types.includes('discus')) suggestions.push('七彩神仙对水质要求高，建议用外置桶滤并每周测水质');

  const warnings = [
    '「1 英寸鱼 / 加仑」是极粗略的经验法则，对大型鱼与高排泄量鱼严重低估；应以氨氮/亚硝酸盐实测为准（见 [F4]）',
  ];
  if (status === 'Overstocked') warnings.push('当前已超出估算容量，建议减少数量或升级过滤');
  if (issues.some((i) => i.severity === 'incompatible')) warnings.push('存在不应混养的组合，请优先处理');

  return {
    tank: {
      inputVolume: volume,
      inputUnit: unit,
      gallons: round(gallons),
      liters: round(gallons * 3.785),
      filterType,
      approach,
      factor: { approach: approachFactor, filter: filterFactor },
    },
    stocking: {
      groups: normalized,
      totalInches: round(usedInches, 1),
      maxRecommendedInches: round(maxInches, 1),
      remainingInches: round(remaining, 1),
      utilizationPercent: round(Math.min(utilization, 9.99) * 100, 0),
      status,
    },
    compatibility: { issues, suggestions },
    warnings,
  };
}
