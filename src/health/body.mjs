/**
 * capability 组：身体状况估算
 * ============================================================
 * 覆盖来源工具：
 *   - health-bac-calculator              血液酒精浓度估算（Widmark 公式）
 *   - beauty-body-measurement-tracker    围度分析（BMI / 腰臀比 / 体型）
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] BAC 不再把「性别」压成二值：站点用 `gender === 'female' ? 0.66 : 0.73`，
 *        任何非 'female' 的输入（包括空值、错别字）都落到男性系数。
 *        本能力要求显式传 `biologicalSex`，取值只能是 'female' / 'male'，
 *        并对「该系数基于生理性别而非性别认同」做出说明。
 *   [F2] 输入单位不再静默兜底：站点用 `parseFloat(x) || 0`，把非法输入变成 0 后
 *        再走 `if (weight <= 0 || drinks <= 0)` 的通用提示，用户看不出到底哪一项错了。
 *        本能力逐字段抛错并指名。
 *   [F3] 腰臀比判定与体型分类拆开：站点把它们混在一次 DOM 更新里，
 *        且用 `Math.min(bust, hips) - waist` 这种含义模糊的中间量。
 *        本能力把「体型分类」「腰臀比风险」「BMI 分级」作为三个独立结果返回，
 *        每一条都能单独核对。
 *   [F4] 明确不做医疗判断：返回值里带 `disclaimer`，且不含任何建议性结论。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   Widmark 公式（BAC = 酒精克数 /(体重克数 × r) × 100）、
 *   每小时代谢 0.015%、标准杯 14 g、BMI 分级边界、体型分类的阈值。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] Widmark 公式忽略饮酒速度、胃内容物、肝功能、药物、体重构成，
 *        个体误差可达 ±0.02% 以上。**不得用于判断是否适合驾驶。**
 *   [L2] 体型分类（沙漏/梨形/苹果形）是民间分类法，不是临床诊断标准。
 *   [L3] 腰臀比阈值来自 WHO 的风险分层，但个体差异大，不能替代临床评估。
 */

const round = (x, n = 2) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

const KG_PER_LB = 0.453592;
const STANDARD_DRINK_GRAMS = 14;
const ELIMINATION_PER_HOUR = 0.015;

export const BAC_DISCLAIMER =
  '本结果由 Widmark 公式估算，忽略饮酒速度、胃内容物、肝功能与用药等因素，个体误差可达 ±0.02% 以上。'
  + '不得用于判断是否适合驾驶或任何法律用途。';

/**
 * 估算血液酒精浓度。
 *
 * @param {object} input
 * @param {number} input.weight 体重
 * @param {'kg'|'lbs'} [input.weightUnit='kg']
 * @param {number} input.drinks 标准杯数（1 杯 = 14 g 纯酒精）
 * @param {number} [input.hours=0] 距首杯已过小时数
 * @param {'female'|'male'} input.biologicalSex 生理性别（Widmark r 系数）
 */
export function estimateBAC(input = {}) {
  const weight = Number(input.weight);
  const unit = input.weightUnit ?? 'kg';
  const drinks = Number(input.drinks);
  const hours = Number(input.hours ?? 0);
  const sex = input.biologicalSex;

  if (!Number.isFinite(weight) || weight <= 0) throw new RangeError('weight 必须是大于 0 的数值');
  if (!['kg', 'lbs'].includes(unit)) throw new RangeError("weightUnit 只能是 'kg' 或 'lbs'");
  if (!Number.isFinite(drinks) || drinks <= 0) throw new RangeError('drinks 必须是大于 0 的数值');
  if (!Number.isFinite(hours) || hours < 0) throw new RangeError('hours 必须是非负数');
  if (sex !== 'female' && sex !== 'male') {
    throw new RangeError("biologicalSex 必须是 'female' 或 'male'（该系数基于生理性别，不表示性别认同）");
  }

  const weightKg = unit === 'lbs' ? weight * KG_PER_LB : weight;
  const r = sex === 'female' ? 0.66 : 0.73;

  const peak = (drinks * STANDARD_DRINK_GRAMS * 100) / (weightKg * 1000 * r);
  const current = Math.max(0, peak - hours * ELIMINATION_PER_HOUR);

  const level =
    current >= 0.08 ? 'legally-impaired'
    : current >= 0.05 ? 'moderate'
    : current >= 0.02 ? 'mild'
    : 'minimal';

  const hoursToSober = current > 0 ? round(current / ELIMINATION_PER_HOUR, 2) : 0;

  const warnings = [BAC_DISCLAIMER];
  if (level === 'legally-impaired') warnings.push('估算值达到常见法定限值（0.08%），但请勿据此判断驾驶能力');
  if (drinks / Math.max(weightKg / 70, 0.5) > 4) warnings.push('短时间内摄入量偏高，代谢个体的差异会显著放大');

  return {
    input: { weight, weightUnit: unit, weightKg: round(weightKg, 2), drinks, hours, biologicalSex: sex },
    widmarkFactor: r,
    peakBAC: round(peak, 3),
    currentBAC: round(current, 3),
    level,
    levelLabel: {
      'legally-impaired': 'High (at or above the common 0.08% limit)',
      moderate: 'Moderate',
      mild: 'Mild',
      minimal: 'Minimal / negligible',
    }[level],
    /** 距估算值归零还需多少小时（按每小时 0.015% 线性代谢） */
    hoursUntilZero: hoursToSober,
    formula: 'BAC = (drinks × 14 g × 100) / (weightKg × 1000 × r) − hours × 0.015',
    disclaimer: BAC_DISCLAIMER,
    warnings,
  };
}

/** WHO 腰臀比风险分层阈值 */
const WHR_THRESHOLDS = Object.freeze({
  female: { low: 0.85, moderate: 0.9 },
  male: { low: 0.9, moderate: 0.95 },
});

function classifyBodyShape(sex, bust, waist, hips) {
  if (sex === 'female') {
    const bustHipDiff = Math.abs(bust - hips);
    const waistDiff = Math.min(bust, hips) - waist;
    if (bustHipDiff <= 5 && waistDiff >= 15) return { key: 'hourglass', name: 'Hourglass', note: '胸臀接近，腰线明显' };
    if (hips > bust + 5) return { key: 'pear', name: 'Pear / Triangle', note: '臀围明显大于胸围' };
    if (bust > hips + 5 && waist < bust - 10) return { key: 'inverted-triangle', name: 'Inverted triangle', note: '肩胸较宽，臀围较窄' };
    if (waist >= bust - 8 && waist >= hips - 8) return { key: 'apple', name: 'Apple / Round', note: '腰腹为主要围度' };
    return { key: 'rectangle', name: 'Rectangle', note: '三围接近，腰线不明显' };
  }
  const chestWaistDiff = bust - waist;
  if (chestWaistDiff >= 15 && hips < bust) return { key: 'inverted-triangle', name: 'Inverted triangle', note: '胸围明显大于臀围' };
  if (hips > bust + 3) return { key: 'pear', name: 'Pear / Triangle', note: '臀围大于胸围' };
  if (waist >= bust - 5) return { key: 'apple', name: 'Apple / Round', note: '腰腹为主要围度' };
  return { key: 'rectangle', name: 'Rectangle', note: '三围接近' };
}

function getBmiCategory(bmi) {
  if (bmi < 18.5) return { key: 'underweight', label: 'Underweight' };
  if (bmi < 25) return { key: 'normal', label: 'Normal' };
  if (bmi < 30) return { key: 'overweight', label: 'Overweight' };
  return { key: 'obese', label: 'Obese' };
}

/**
 * 围度分析：BMI + 腰臀比 + 体型。
 *
 * @param {object} input
 * @param {'female'|'male'} input.biologicalSex
 * @param {number} input.heightCm
 * @param {number} input.weightKg
 * @param {number} input.bustCm 胸围（男性填胸围）
 * @param {number} input.waistCm 腰围
 * @param {number} input.hipsCm 臀围
 */
export function analyzeBodyMeasurements(input = {}) {
  const sex = input.biologicalSex;
  if (sex !== 'female' && sex !== 'male') throw new RangeError("biologicalSex 必须是 'female' 或 'male'");

  const nums = {};
  for (const [key, label] of [
    ['heightCm', '身高'], ['weightKg', '体重'], ['bustCm', '胸围'], ['waistCm', '腰围'], ['hipsCm', '臀围'],
  ]) {
    const v = Number(input[key]);
    if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${key}（${label}）必须是大于 0 的数值`);
    nums[key] = v;
  }

  const { heightCm, weightKg, bustCm, waistCm, hipsCm } = nums;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  const bmiRounded = round(bmi, 1);
  const bmiCategory = getBmiCategory(bmi);

  const whr = waistCm / hipsCm;
  const th = WHR_THRESHOLDS[sex];
  const whrRisk = whr < th.low ? 'low' : whr < th.moderate ? 'moderate' : 'high';

  const shape = classifyBodyShape(sex, bustCm, waistCm, hipsCm);

  const warnings = [
    '体型分类是民间分类法，不是临床诊断标准；腰臀比阈值来自 WHO 风险分层，个体差异较大，不能替代临床评估',
  ];
  if (bmiRounded >= 40 || bmiRounded < 15) warnings.push('BMI 处于极端区间，请以医学检查结果为准');
  if (heightCm < 100 || heightCm > 250) warnings.push('身高超出常见生理范围，结果仅供参考');

  return {
    input: { biologicalSex: sex, ...nums },
    bmi: {
      value: bmiRounded,
      category: bmiCategory.key,
      categoryLabel: bmiCategory.label,
      healthyRangeKg: {
        low: round(18.5 * heightM * heightM, 1),
        high: round(24.9 * heightM * heightM, 1),
      },
    },
    waistToHip: {
      ratio: round(whr, 2),
      risk: whrRisk,
      thresholds: th,
    },
    bodyShape: shape,
    heightInInches: round(heightCm / 2.54, 1),
    /** BMI 归一化到 0~100 的位置（15 → 0，40 → 100），与站点工具的进度条口径一致 */
    bmiScalePercent: Math.min(100, Math.max(0, round(((bmi - 15) / 25) * 100, 0))),
    warnings,
  };
}

export const CAPABILITY_GROUP = 'health/body';
