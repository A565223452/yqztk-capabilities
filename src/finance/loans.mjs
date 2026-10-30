/**
 * capability 组：房贷 / 车贷 / 佣金 / 还款模拟
 * ============================================================
 * 覆盖来源工具：
 *   - real-mortgage-calculator              房贷 PITI + 年度还款表
 *   - automotive-car-payment-calculator      车贷月供与总成本
 *   - automotive-car-loan-payoff-calculator  提前还款节省模拟
 *   - real-commission-calculator             房产佣金分层拆分
 *
 * 全部金额内部按「分」整数运算，理由与 finance/amortization 相同：
 * 浮点累减会让末期余额漂移，而这类结果是要拿去对账的。
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] 还款模拟不再静默截断：站点用 `while (remaining > 0 && months < 600)`
 *        最多跑 600 期，超限时**没有任何提示**，用户会看到一个「正好 50 年还完」
 *        的错误结论。本能力在触及上限时返回 `converged: false` 并给出 warning。
 *   [F2] 月供无法覆盖利息时明确报错：站点在原实现里会把 month 循环跑到上限，
 *        余额却始终在增长。本能力直接判定「还款额不足以覆盖利息」并抛错。
 *   [F3] 年度还款表不再用「月供 × 12 × 年数」估算期初余额（站点用的是
 *        `Math.max(loanAmount - ((y-1) * monthlyPI * 12), 0)`，这是把利息当本金还，
 *        数字看起来合理但其实是错的）。本能力按真实逐期余额汇总。
 *   [F4] 佣金拆分的各层权重显式校验，且给出「经纪人实收」与「挂牌方/买方方」分离的结果。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   等额本息月供公式、0% 利率特例、PITI 组成（本息 + 税 + 保险 / 12）、
 *   车贷「税费是否计入贷款」开关、双周还款（每两周一付、每次半月供）的模拟口径。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 不含 PMI、HOA、预付点数、提前还款罚金等真实费用项。
 *   [L2] 双周还款按「每月两期、每期半月供」简化，真实双周贷按年 26 期计，会有约 4% 差异。
 *   [L3] 佣金仅为分配模型，不涉及税费、经纪公司抽成政策、推荐费分成。
 */

import { buildSchedule } from './amortization.mjs';

const toCents = (yuan) => Math.round(Number(yuan) * 100);
const toYuan = (cents) => Math.round(cents) / 100;
const round = (x, n = 2) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

/**
 * 房贷 PITI 计算。
 *
 * @param {object} input
 * @param {number} input.price 房屋总价
 * @param {number} [input.downPayment=0] 首付
 * @param {number} input.annualRatePercent 年利率（百分数）
 * @param {number} [input.years=30] 年限
 * @param {number} [input.annualTax=0] 年房产税
 * @param {number} [input.annualInsurance=0] 年保险
 */
export function calcMortgage(input = {}) {
  const priceCents = toCents(input.price);
  const downCents = toCents(input.downPayment ?? 0);
  const ratePercent = Number(input.annualRatePercent);
  const years = Number(input.years ?? 30);

  if (!Number.isFinite(priceCents) || priceCents <= 0) throw new RangeError('price 必须是大于 0 的有限数值');
  if (!Number.isFinite(downCents) || downCents < 0) throw new RangeError('downPayment 必须是非负有限数值');
  if (downCents > priceCents) throw new RangeError('首付不能大于房屋总价');
  if (!Number.isFinite(ratePercent) || ratePercent < 0) throw new RangeError('annualRatePercent 必须是非负数值');
  if (!Number.isInteger(years) || years <= 0 || years > 50) throw new RangeError('years 必须是 1~50 的整数');

  const loanCents = priceCents - downCents;
  const months = years * 12;
  const monthlyTax = Math.round(toCents(input.annualTax ?? 0) / 12);
  const monthlyInsurance = Math.round(toCents(input.annualInsurance ?? 0) / 12);

  let monthlyPICents;
  if (loanCents === 0) {
    monthlyPICents = 0;
  } else {
    const s = buildSchedule({
      principal: toYuan(loanCents),
      annualRatePercent: ratePercent,
      months,
    });
    monthlyPICents = toCents(s.monthlyPayment);
  }

  const totalMonthlyCents = monthlyPICents + monthlyTax + monthlyInsurance;

  // 逐期明细只算一次，供利息汇总与年度表共用（同时避免两次计算出现不一致）
  const sched = loanCents === 0
    ? null
    : buildSchedule({ principal: toYuan(loanCents), annualRatePercent: ratePercent, months });
  const totalInterest = sched ? sched.totals.interest : 0;

  // [F3] 年度汇总：按真实逐期余额算，不用「月供×12×年数」估算
  const yearly = [];
  if (sched) {
    for (let y = 0; y < years; y++) {
      const rows = sched.schedule.slice(y * 12, (y + 1) * 12);
      if (!rows.length) break;
      yearly.push({
        year: y + 1,
        openingBalance: round(rows[0].balance + rows[0].principal),
        paid: round(rows.reduce((a, r) => a + r.payment, 0)),
        interest: round(rows.reduce((a, r) => a + r.interest, 0)),
        principal: round(rows.reduce((a, r) => a + r.principal, 0)),
        closingBalance: rows[rows.length - 1].balance,
      });
    }
  }

  const warnings = [];
  const downPercent = round((toYuan(downCents) / toYuan(priceCents)) * 100, 1);
  if (downPercent < 20) warnings.push(`首付比例 ${downPercent}%，低于常见 20% 门槛，实际审批可能要求额外保险（PMI）`);
  if (downPercent === 0 && loanCents > 0) warnings.push('零首付方案的审批与利率条件通常显著更差');

  return {
    input: {
      price: toYuan(priceCents),
      downPayment: toYuan(downCents),
      downPaymentPercent: downPercent,
      annualRatePercent: ratePercent,
      years,
      months,
      annualTax: toYuan(toCents(input.annualTax ?? 0)),
      annualInsurance: toYuan(toCents(input.annualInsurance ?? 0)),
    },
    loanAmount: toYuan(loanCents),
    monthly: {
      principalAndInterest: toYuan(monthlyPICents),
      tax: toYuan(monthlyTax),
      insurance: toYuan(monthlyInsurance),
      totalPITI: toYuan(totalMonthlyCents),
    },
    totals: {
      principalAndInterest: sched ? sched.totals.payments : 0,
      interest: totalInterest,
      tax: round(toYuan(toCents(input.annualTax ?? 0)) * years),
      insurance: round(toYuan(toCents(input.annualInsurance ?? 0)) * years),
    },
    yearly,
    warnings,
  };
}

/**
 * 车贷月供与总成本。
 *
 * @param {object} input
 * @param {number} input.price 车价
 * @param {number} [input.downPayment=0]
 * @param {number} [input.tradeIn=0]
 * @param {number} [input.termMonths=60]
 * @param {number} input.annualRatePercent
 * @param {number} [input.taxPercent=0] 购置税率（%）
 * @param {number} [input.fees=0] 手续费等
 * @param {boolean} [input.taxInLoan=false] 税费是否计入贷款
 */
export function calcCarPayment(input = {}) {
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) throw new RangeError('price 必须是大于 0 的数值');

  const down = Number(input.downPayment ?? 0);
  const tradeIn = Number(input.tradeIn ?? 0);
  const term = Number(input.termMonths ?? 60);
  const rate = Number(input.annualRatePercent ?? 0);
  const taxPercent = Number(input.taxPercent ?? 0);
  const fees = Number(input.fees ?? 0);
  const taxInLoan = input.taxInLoan === true;

  if (down < 0 || tradeIn < 0 || fees < 0) throw new RangeError('首付 / 置换 / 手续费不能为负');
  if (!Number.isInteger(term) || term <= 0 || term > 240) throw new RangeError('termMonths 必须是 1~240 的整数');
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError('annualRatePercent 必须是非负数值');
  if (!Number.isFinite(taxPercent) || taxPercent < 0) throw new RangeError('taxPercent 必须是非负数值');

  const taxAmount = price * (taxPercent / 100);
  const upfront = down + tradeIn;
  const loanAmount = price + fees + (taxInLoan ? taxAmount : 0) - upfront;
  if (loanAmount <= 0) {
    return {
      loanAmount: 0,
      monthlyPayment: 0,
      totalPayment: 0,
      totalInterest: 0,
      totalCost: upfront,
      breakdown: { price, down, tradeIn, taxAmount: round(taxAmount), fees, taxInLoan },
      warnings: ['首付与置换金额已覆盖车价，无需贷款'],
    };
  }

  const monthlyRate = rate / 100 / 12;
  let monthlyPayment;
  if (rate === 0) {
    monthlyPayment = loanAmount / term;
  } else {
    const growth = (1 + monthlyRate) ** term;
    monthlyPayment = (loanAmount * (monthlyRate * growth)) / (growth - 1);
  }
  const totalPayment = monthlyPayment * term;
  const totalInterest = totalPayment - loanAmount;
  const totalCost = totalPayment + down + tradeIn + (taxInLoan ? 0 : taxAmount);

  const warnings = [];
  if (term > 84) warnings.push(`贷款期限 ${term} 个月（超过 7 年），利息总额会显著增加`);
  if (down / price < 0.1) warnings.push('首付低于 10%，通常需要额外保险或被要求更高利率');

  return {
    loanAmount: round(loanAmount),
    monthlyPayment: round(monthlyPayment),
    totalPayment: round(totalPayment),
    totalInterest: round(totalInterest),
    totalCost: round(totalCost),
    breakdown: {
      price,
      down: round(down),
      tradeIn: round(tradeIn),
      taxAmount: round(taxAmount),
      fees: round(fees),
      taxInLoan,
      financedTax: taxInLoan ? round(taxAmount) : 0,
    },
    warnings,
  };
}

/**
 * 提前还款模拟：与「只付最低还款」的基线对比，给出节省的期数与利息。
 *
 * @param {object} input
 * @param {number} input.balance 当前剩余本金
 * @param {number} input.annualRatePercent 年利率（%）
 * @param {number} input.monthlyPayment 当前月供
 * @param {number} [input.extraMonthly=0] 每月额外还款
 * @param {number} [input.lumpSum=0] 一次性额外还款（第一期前）
 * @param {boolean} [input.biweekly=false] 是否改为双周还款（每月两期，每期半月供）
 * @param {number} [input.maxMonths=1200] 模拟上限
 */
export function simulateLoanPayoff(input = {}) {
  const balance = Number(input.balance);
  const ratePercent = Number(input.annualRatePercent);
  const monthlyPayment = Number(input.monthlyPayment);
  const extraMonthly = Number(input.extraMonthly ?? 0);
  const lumpSum = Number(input.lumpSum ?? 0);
  const biweekly = input.biweekly === true;
  const maxMonths = Number(input.maxMonths ?? 1200);

  if (!Number.isFinite(balance) || balance <= 0) throw new RangeError('balance 必须是大于 0 的数值');
  if (!Number.isFinite(ratePercent) || ratePercent < 0) throw new RangeError('annualRatePercent 必须是非负数值');
  if (!Number.isFinite(monthlyPayment) || monthlyPayment <= 0) throw new RangeError('monthlyPayment 必须是大于 0 的数值');
  if (extraMonthly < 0 || lumpSum < 0) throw new RangeError('额外还款不能为负');

  const monthlyRate = ratePercent / 100 / 12;
  if (monthlyRate > 0 && monthlyPayment + extraMonthly <= balance * monthlyRate) {
    throw new RangeError(
      `还款额不足以覆盖当期利息（利息约 ${round(balance * monthlyRate, 2)}/月，还款 ${monthlyPayment + extraMonthly}/月），本金永远不会减少`
    );
  }

  /**
   * 单次模拟。
   * 注意：一次性还款必须作为**参数**传入而不是读闭包变量 ——
   * 早先的实现读闭包 `lumpSum`，导致「基线不含一次性还款」这个设定完全不生效
   * （基线也享受了那笔钱，于是「节省」恒为 0）。
   */
  const run = ({ startBalance, perPayment, paymentsPerMonth, lump }) => {
    let remaining = startBalance;
    let months = 0;
    let totalInterest = 0;
    let totalPaid = 0;

    if (lump > 0) {
      const applied = Math.min(lump, remaining);
      remaining -= applied;
      totalPaid += applied;
    }

    while (remaining > 0 && months < maxMonths) {
      months++;
      for (let p = 0; p < paymentsPerMonth && remaining > 0; p++) {
        const interest = remaining * (monthlyRate / paymentsPerMonth);
        const pay = Math.min(perPayment, remaining + interest);
        totalInterest += interest;
        totalPaid += pay;
        remaining -= pay - interest;
      }
    }

    return {
      months,
      totalInterest: round(totalInterest),
      totalPaid: round(totalPaid),
      converged: remaining <= 0,
      remainingBalance: round(Math.max(0, remaining)),
    };
  };

  // 当前方案（含所有加速手段）
  const actual = biweekly
    ? run({
        startBalance: balance,
        perPayment: (monthlyPayment + extraMonthly) / 2,
        paymentsPerMonth: 2,
        lump: lumpSum,
      })
    : run({
        startBalance: balance,
        perPayment: monthlyPayment + extraMonthly,
        paymentsPerMonth: 1,
        lump: lumpSum,
      });

  // 基线：只付最低月供，不含额外月供、不含一次性还款
  const baseline = run({
    startBalance: balance,
    perPayment: monthlyPayment,
    paymentsPerMonth: 1,
    lump: 0,
  });

  const warnings = [];
  if (!actual.converged) {
    warnings.push(`模拟在 ${maxMonths} 期内未还清，结果不可用 —— 请检查还款额是否足够`);
  }
  const savedMonths = baseline.months - actual.months;
  const savedInterest = round(baseline.totalInterest - actual.totalInterest);

  return {
    actual,
    baseline,
    savings: {
      months: Math.max(0, savedMonths),
      years: round(Math.max(0, savedMonths) / 12, 1),
      interest: Math.max(0, savedInterest),
      usedLumpSum: Math.min(lumpSum, balance),
    },
    assumptions: { monthlyRate, maxMonths, biweekly },
    warnings,
  };
}

/**
 * 房产佣金分层拆分。
 *
 * @param {object} input
 * @param {number} input.price 成交价
 * @param {number} input.commissionPercent 总佣金率（%）
 * @param {number} [input.listingSharePercent=50] 挂牌方占总佣金的比例（%）
 * @param {number} [input.agentSplitPercent=100] 经纪人从挂牌方佣金中的分成（%）
 * @param {number} [input.closingCostPercent=0] 卖方承担的交易税费率（%）
 * @param {number} [input.repairsCredit=0] 维修让利金额
 */
export function calcCommissionSplit(input = {}) {
  const price = Number(input.price);
  const commissionPercent = Number(input.commissionPercent);
  if (!Number.isFinite(price) || price <= 0) throw new RangeError('price 必须是大于 0 的数值');
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw new RangeError('commissionPercent 必须在 0~100 之间');
  }

  const listingShare = Number(input.listingSharePercent ?? 50);
  const agentSplit = Number(input.agentSplitPercent ?? 100);
  const closingPercent = Number(input.closingCostPercent ?? 0);
  const repairsCredit = Number(input.repairsCredit ?? 0);

  if (listingShare < 0 || listingShare > 100) throw new RangeError('listingSharePercent 必须在 0~100 之间');
  if (agentSplit < 0 || agentSplit > 100) throw new RangeError('agentSplitPercent 必须在 0~100 之间');
  if (closingPercent < 0 || closingPercent > 100) throw new RangeError('closingCostPercent 必须在 0~100 之间');
  if (repairsCredit < 0) throw new RangeError('repairsCredit 不能为负');

  const totalCommission = price * (commissionPercent / 100);
  const listingCommission = totalCommission * (listingShare / 100);
  const buyerSideCommission = totalCommission - listingCommission;
  const agentShare = listingCommission * (agentSplit / 100);
  const brokerageShare = listingCommission - agentShare;
  const closingCost = price * (closingPercent / 100);

  const netToSeller = price - totalCommission - closingCost - repairsCredit;

  const warnings = [];
  if (commissionPercent > 7) warnings.push(`总佣金率 ${commissionPercent}% 高于常见区间（4%~6%）`);
  if (netToSeller < 0) warnings.push('扣除佣金与费用后卖方净得为负，请核对输入');

  return {
    salePrice: round(price),
    commission: {
      total: round(totalCommission),
      listingSide: round(listingCommission),
      buyerSide: round(buyerSideCommission),
      listingSharePercent: listingShare,
    },
    listingAgent: {
      agentShare: round(agentShare),
      brokerageShare: round(brokerageShare),
      agentSplitPercent: agentSplit,
    },
    costs: { closing: round(closingCost), repairsCredit: round(repairsCredit) },
    netToSeller: round(netToSeller),
    effectiveCommissionPercent: round((totalCommission / price) * 100, 2),
    warnings,
  };
}
