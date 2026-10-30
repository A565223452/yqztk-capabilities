/**
 * capability: finance/amortization
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/finance-amortization-schedule-generator
 * 版本：1.0.0
 *
 * 为什么这个能力值得放在第一批：
 *   房贷/车贷摊销表是典型的「AI 算不可信」场景——它是长链条精确计算，
 *   且结果会被拿去对账、报税、做还款决策。LLM 给一个数字，无法证明它对；
 *   本能力给出完整的逐期明细，且满足三条可在测试里断言的恒等式（见下）。
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 0% 利率：站点实现 `if (!loan || !r || !n) return` —— 利率为 0 时
 *        直接返回空白。但无息贷款是完全合法的输入（车企贴息、亲友借款），
 *        该判断把一类真实需求判成了「非法输入」。本实现正确处理 0 利率。
 *   [F2] 金额以「分」为整数单位运算：站点实现全程用浮点累减，
 *        `balance -= principal` 会累积 IEEE-754 误差，导致末期余额不是 0。
 *        本实现内部统一用整数 cents，利息按分四舍五入（银行实务），
 *        本金 = 还款额 − 利息，因此每一期都自洽。
 *   [F3] 末期调整（adjustFinalPayment）：最后一期还款额被调整为使余额精确归零。
 *        站点实现不做调整，末期余额留残余、且不体现在界面上。
 *   [F4] 不掩盖超还：站点用 `Math.max(0, balance)` 把负余额显示成 0，
 *        掩盖了「还款额大于本息总和」的异常。本实现不掩盖，并在 warnings 中报告。
 *   [F5] 返回机器可读对象 + 恒等式校验结果，而不是拼好的 HTML 表格。
 *
 * ── 可在测试中断言的三条恒等式 ──────────────────────────────────
 *   (1) Σ 每期本金 = 原始本金            （精确到分）
 *   (2) Σ 每期利息 = 利息总额            （精确到分）
 *   (3) 末期结清后余额 = 0               （精确到分）
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 按「等额本息」计算，不支持等额本金、气球贷、宽限期、提前还款重算。
 *   [L2] 按自然月分期，不处理日期（不含实际放款日、不含按日计息）。
 *   [L3] 利率为名义年利率 / 12，不含手续费、保险、服务费等真实年化要素。
 *   [L4] 结果用于估算与对账参考，不构成金融建议；正式还款计划以金融机构为准。
 */

export const CAPABILITY = Object.freeze({
  id: 'finance/amortization',
  version: '1.0.0',
  sourceTool: 'finance-amortization-schedule-generator',
  deterministic: true,
  networkAccess: false,
});

/** 元 → 分（整数）。用四舍五入避免 0.1+0.2 类误差。 */
const toCents = (yuan) => Math.round(Number(yuan) * 100);
/** 分 → 元。 */
const toYuan = (cents) => Math.round(cents) / 100;

/**
 * 生成等额本息还款计划。
 *
 * @param {object} input
 * @param {number} input.principal          贷款本金（元）。必须 > 0。
 * @param {number} input.annualRatePercent  名义年利率（百分数，例如 6 表示 6%）。允许 0。
 * @param {number} input.months             期数（月）。必须为正整数。
 * @param {boolean} [input.adjustFinalPayment=true] 是否调整末期还款额使余额精确归零。
 * @returns {{
 *   monthlyPayment:number,
 *   schedule:Array<{period:number,payment:number,principal:number,interest:number,balance:number}>,
 *   totals:{payments:number,principal:number,interest:number},
 *   identities:{principalClosed:boolean,interestMatches:boolean,balanceZero:boolean},
 *   warnings:string[]
 * }}
 */
export function buildSchedule(input = {}) {
  const principalCents = toCents(input.principal);
  const annualRatePercent = Number(input.annualRatePercent);
  const months = Number(input.months);
  const adjustFinalPayment = input.adjustFinalPayment !== false;

  if (!Number.isFinite(principalCents) || principalCents <= 0) {
    throw new RangeError('principal 必须是大于 0 的有限数值（元）');
  }
  if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0) {
    throw new RangeError('annualRatePercent 必须是非负有限数值（百分数，例如 6 表示 6%）');
  }
  if (!Number.isInteger(months) || months <= 0) {
    throw new RangeError('months 必须是大于 0 的整数');
  }
  if (months > 1200) {
    throw new RangeError('months 上限为 1200（100 年），超出视为输入错误');
  }

  const monthlyRate = annualRatePercent / 100 / 12;
  const warnings = [];

  // 每期还款额（分）。0 利率是特例：直接本金均摊，公式会除以 0。
  let paymentCents;
  if (monthlyRate === 0) {
    paymentCents = Math.round(principalCents / months);
  } else {
    const growth = Math.pow(1 + monthlyRate, months);
    paymentCents = Math.round((principalCents * (monthlyRate * growth)) / (growth - 1));
  }

  const schedule = [];
  let balance = principalCents;
  let sumPrincipal = 0;
  let sumInterest = 0;
  let sumPayment = 0;

  for (let period = 1; period <= months; period++) {
    const interest = Math.round(balance * monthlyRate);
    let payment = paymentCents;
    let principal = payment - interest;

    const isLast = period === months;
    if (isLast && adjustFinalPayment) {
      // 末期以「结清余额」为准：payment = 余额 + 当期利息，使余额精确归零。
      principal = balance;
      payment = balance + interest;
    }

    if (principal > balance) {
      // 只在未做末期调整时可能出现（多还）。不掩盖，报告出来。
      warnings.push(`第 ${period} 期本金超过剩余余额，余额将变为负值（未启用末期调整）`);
      principal = balance;
      payment = principal + interest;
    }

    const nextBalance = balance - principal;
    if (nextBalance < 0) {
      warnings.push(`第 ${period} 期后余额为负，说明还款额大于剩余本息`);
    }

    schedule.push({
      period,
      payment: toYuan(payment),
      principal: toYuan(principal),
      interest: toYuan(interest),
      balance: toYuan(nextBalance),
    });

    sumPayment += payment;
    sumPrincipal += principal;
    sumInterest += interest;
    balance = nextBalance;

    if (isLast && adjustFinalPayment) {
      balance = 0; // 末期调整后精确归零，切断浮点残留
    }
  }

  const identities = {
    principalClosed: sumPrincipal === principalCents,
    interestMatches: sumInterest === sumPayment - principalCents,
    balanceZero: balance === 0,
  };

  if (!identities.balanceZero && adjustFinalPayment) {
    warnings.push('末期调整已启用但余额未归零，属实现缺陷，请报告');
  }
  if (!identities.principalClosed) {
    warnings.push('Σ本金 ≠ 原始本金，属实现缺陷，请报告');
  }

  return {
    monthlyPayment: toYuan(paymentCents),
    schedule,
    totals: {
      payments: toYuan(sumPayment),
      principal: toYuan(sumPrincipal),
      interest: toYuan(sumInterest),
    },
    identities,
    warnings,
  };
}

/** 仅要每期还款额时用这个（不需要完整明细）。 */
export function monthlyPayment(principal, annualRatePercent, months) {
  return buildSchedule({ principal, annualRatePercent, months }).monthlyPayment;
}
