/**
 * capability: health/bmi
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/health-bmi-calculator
 * 版本：1.0.0
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 不接收 age / gender：站点表单让用户填年龄与性别，但代码读完这两个值
 *        之后一次都没用过 —— 结果是「收集了用不到的敏感健康信息」。
 *        本能力**在签名层面就不接受**这两个字段：不需要的数据就不该被传进来。
 *        这是「Private」这条约束的具体落实，不是功能缺失。
 *   [F2] 极端值不再静默：站点对 height=1000cm 这类输入照常给出一个 BMI 数字。
 *        本能力对超出人类生理范围的输入给出显式 warning，同时保留计算结果
 *        （极端值在医疗场景下可能是真实数据，不该直接拒绝）。
 *   [F3] 取整口径与站点一致（BMI 保留 1 位小数；理想体重按单位取整），
 *        但不再用 `parseFloat(x) || 0` 把非法输入静默变成 0。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   BMI 公式（公制 weight/(height/100)^2、英制 703*weight/height^2）、
 *   WHO 成人分级边界（18.5 / 25 / 30 / 35 / 40）、
 *   理想体重区间 18.5–24.9 及英制换算系数 0.453592 与原工具完全一致。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] BMI 不区分脂肪与肌肉，对运动员、孕妇、老年人会明显失真。
 *   [L2] 使用 WHO 成人标准，不适用于儿童青少年（需按年龄性别查百分位曲线）。
 *   [L3] 本能力只做数值计算，不构成任何医疗建议。
 */

export const CAPABILITY = Object.freeze({
  id: 'health/bmi',
  version: '1.0.0',
  sourceTool: 'health-bmi-calculator',
  deterministic: true,
  networkAccess: false,
  /** [F1] 显式声明不接受哪些字段，防止上游把不必要的数据传进来 */
  rejectedInputs: ['age', 'gender', 'name', 'email'],
});

const KG_PER_LB = 0.453592;
const CM_PER_IN = 2.54;

const CATEGORIES = [
  { max: 18.5, key: 'underweight', label: 'Underweight', risk: 'moderate', note: 'May indicate malnutrition or being underweight.' },
  { max: 25, key: 'normal', label: 'Normal weight', risk: 'low', note: 'Low health risk.' },
  { max: 30, key: 'overweight', label: 'Overweight', risk: 'elevated', note: 'Increased risk of heart disease and diabetes.' },
  { max: 35, key: 'obese-1', label: 'Obese (Class I)', risk: 'high', note: 'High risk of serious health conditions.' },
  { max: 40, key: 'obese-2', label: 'Obese (Class II)', risk: 'very-high', note: 'Very high risk.' },
  { max: Infinity, key: 'obese-3', label: 'Obese (Class III)', risk: 'severe', note: 'Severe risk, medical intervention recommended.' },
];

/**
 * 计算 BMI。
 *
 * @param {object} input
 * @param {number} input.height 身高（公制 cm / 英制 in）
 * @param {number} input.weight 体重（公制 kg / 英制 lb）
 * @param {'metric'|'imperial'} [input.unit='metric']
 * @returns {object} 结构化结果
 */
export function computeBMI(input = {}) {
  const unit = input.unit === undefined ? 'metric' : input.unit;
  if (unit !== 'metric' && unit !== 'imperial') {
    throw new RangeError("unit 只能是 'metric' 或 'imperial'");
  }

  const height = Number(input.height);
  const weight = Number(input.weight);
  if (!Number.isFinite(height) || height <= 0) throw new RangeError('height 必须是大于 0 的有限数值');
  if (!Number.isFinite(weight) || weight <= 0) throw new RangeError('weight 必须是大于 0 的有限数值');

  const warnings = [];
  const bounds = unit === 'metric'
    ? { hMin: 50, hMax: 260, wMin: 2, wMax: 500, hUnit: 'cm', wUnit: 'kg' }
    : { hMin: 20, hMax: 102, wMin: 5, wMax: 1100, hUnit: 'in', wUnit: 'lb' };

  if (height < bounds.hMin || height > bounds.hMax) {
    warnings.push(`身高 ${height}${bounds.hUnit} 超出常见生理范围（${bounds.hMin}–${bounds.hMax}${bounds.hUnit}），结果仅供参考`);
  }
  if (weight < bounds.wMin || weight > bounds.wMax) {
    warnings.push(`体重 ${weight}${bounds.wUnit} 超出常见生理范围（${bounds.wMin}–${bounds.wMax}${bounds.wUnit}），结果仅供参考`);
  }

  const heightM = unit === 'metric' ? height / 100 : height * CM_PER_IN / 100;
  const bmiRaw = unit === 'metric' ? weight / (height / 100) ** 2 : (703 * weight) / height ** 2;
  const bmi = Math.round(bmiRaw * 10) / 10;

  const cat = CATEGORIES.find((c) => bmi < c.max);

  const idealLowKg = 18.5 * heightM * heightM;
  const idealHighKg = 24.9 * heightM * heightM;
  const toUnit = (kg) => (unit === 'metric' ? Math.round(kg) : Math.round(kg / KG_PER_LB));

  if (!Number.isFinite(bmi)) warnings.push('计算结果不是有限数，请检查输入');

  return {
    bmi,
    category: cat.label,
    categoryKey: cat.key,
    riskLevel: cat.risk,
    riskNote: cat.note,
    idealWeightRange: {
      low: toUnit(idealLowKg),
      high: toUnit(idealHighKg),
      unit: unit === 'metric' ? 'kg' : 'lb',
    },
    input: { height, weight, unit, heightM: Math.round(heightM * 1000) / 1000 },
    warnings,
    applicability: [
      'BMI 不区分脂肪与肌肉，对运动员、孕妇、老年人会明显失真',
      '使用 WHO 成人标准，不适用于儿童青少年',
      '不构成医疗建议',
    ],
  };
}
