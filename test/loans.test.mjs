/**
 * finance/loans 测试
 * 重点是 [F1]/[F3]：还款模拟不得静默截断，年度汇总必须基于真实逐期余额。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcMortgage, calcCarPayment, simulateLoanPayoff, calcCommissionSplit } from '../src/finance/loans.mjs';

test('房贷：40 万 / 6% / 30 年 → 本息 2398.20（10 万 → 599.55 的 4 倍）', () => {
  const r = calcMortgage({ price: 400000, downPayment: 0, annualRatePercent: 6, years: 30 });
  assert.equal(r.monthly.principalAndInterest, 2398.2);
});

test('房贷：PITI = 本息 + 税/12 + 保险/12', () => {
  const r = calcMortgage({ price: 400000, annualRatePercent: 6, years: 30, annualTax: 6000, annualInsurance: 1200 });
  assert.equal(r.monthly.tax, 500);
  assert.equal(r.monthly.insurance, 100);
  assert.equal(r.monthly.totalPITI, 2998.2);
});

test('房贷：利息总额来自逐期明细，且年表首年末余额小于本金', () => {
  const r = calcMortgage({ price: 400000, annualRatePercent: 6, years: 30 });
  assert.ok(r.totals.interest > 0);
  assert.equal(r.yearly.length, 30);
  assert.equal(r.yearly[0].openingBalance, 400000);
  assert.ok(r.yearly[0].closingBalance < 400000);
  assert.equal(r.yearly[29].closingBalance, 0, '第 30 年末必须结清');
});

test('房贷：Σ各年本金 = 贷款本金（[F3] 真实余额而非估算）', () => {
  const r = calcMortgage({ price: 300000, downPayment: 50000, annualRatePercent: 5.5, years: 15 });
  const sumPrincipal = Math.round(r.yearly.reduce((a, y) => a + y.principal, 0) * 100);
  assert.equal(sumPrincipal, 25000000, '应以分为单位精确等于 250000 元');
});

test('房贷：0% 利率也能算（站点此处会崩）', () => {
  const r = calcMortgage({ price: 120000, annualRatePercent: 0, years: 10 });
  assert.equal(r.monthly.principalAndInterest, 1000);
  assert.equal(r.totals.interest, 0);
});

test('房贷：首付高于房价时抛错；低首付有告警', () => {
  assert.throws(() => calcMortgage({ price: 100000, downPayment: 200000, annualRatePercent: 5 }), RangeError);
  const low = calcMortgage({ price: 400000, downPayment: 30000, annualRatePercent: 6, years: 30 });
  assert.ok(low.warnings.some((w) => w.includes('PMI') || w.includes('首付比例')));
});

test('车贷：2.5 万 / 5% / 60 期 → 月供 471.78', () => {
  const r = calcCarPayment({ price: 30000, downPayment: 5000, termMonths: 60, annualRatePercent: 5 });
  assert.equal(r.monthlyPayment, 471.78);
  assert.equal(r.loanAmount, 25000);
});

test('车贷：税费是否计入贷款影响贷款额', () => {
  const outside = calcCarPayment({ price: 30000, downPayment: 5000, termMonths: 60, annualRatePercent: 5, taxPercent: 7 });
  const inside = calcCarPayment({ price: 30000, downPayment: 5000, termMonths: 60, annualRatePercent: 5, taxPercent: 7, taxInLoan: true });
  assert.equal(outside.loanAmount, 25000);
  assert.equal(inside.loanAmount, 27100);
  assert.ok(inside.totalCost > outside.totalCost);
});

test('车贷：0% 利率走本金均摊', () => {
  const r = calcCarPayment({ price: 24000, termMonths: 24, annualRatePercent: 0 });
  assert.equal(r.monthlyPayment, 1000);
  assert.equal(r.totalInterest, 0);
});

test('车贷：首付已覆盖车价时返回 0 贷款并给出说明', () => {
  const r = calcCarPayment({ price: 20000, downPayment: 25000, annualRatePercent: 5 });
  assert.equal(r.loanAmount, 0);
  assert.ok(r.warnings.length > 0);
});

test('还款模拟：额外还款缩短期限并节省利息', () => {
  const r = simulateLoanPayoff({ balance: 20000, annualRatePercent: 6, monthlyPayment: 500, extraMonthly: 200 });
  assert.ok(r.savings.months > 0, '应有期限节省');
  assert.ok(r.savings.interest > 0, '应有利益节省');
  assert.ok(r.actual.months < r.baseline.months);
});

test('还款模拟：无额外还款时与基线一致', () => {
  const r = simulateLoanPayoff({ balance: 10000, annualRatePercent: 5, monthlyPayment: 400 });
  assert.equal(r.actual.months, r.baseline.months);
  assert.equal(r.savings.months, 0);
});

test('还款模拟：一次性还款计入节省', () => {
  const r = simulateLoanPayoff({ balance: 20000, annualRatePercent: 6, monthlyPayment: 500, lumpSum: 5000 });
  assert.equal(r.savings.usedLumpSum, 5000);
  assert.ok(r.actual.months < r.baseline.months);
});

test('[F2] 还款额不足以覆盖利息时抛错，而不是跑到期数上限', () => {
  assert.throws(
    () => simulateLoanPayoff({ balance: 100000, annualRatePercent: 12, monthlyPayment: 500 }),
    /不足以覆盖当期利息/
  );
});

test('[F1] 模拟未收敛时 converged=false 并给出告警', () => {
  // 极低还款额配合极低利率仍是有效的，但把上限压到 2 期就必然不收敛
  const r = simulateLoanPayoff({ balance: 100000, annualRatePercent: 0.5, monthlyPayment: 1000, maxMonths: 2 });
  assert.equal(r.actual.converged, false);
  assert.ok(r.warnings.some((w) => w.includes('未还清')));
});

test('佣金拆分：500000 / 5% / 挂牌方 50% / 经纪人 70%', () => {
  const r = calcCommissionSplit({ price: 500000, commissionPercent: 5, listingSharePercent: 50, agentSplitPercent: 70 });
  assert.equal(r.commission.total, 25000);
  assert.equal(r.commission.listingSide, 12500);
  assert.equal(r.commission.buyerSide, 12500);
  assert.equal(r.listingAgent.agentShare, 8750);
  assert.equal(r.listingAgent.brokerageShare, 3750);
});

test('佣金拆分：卖方净得 = 售价 − 总佣金 − 交易费 − 让利', () => {
  const r = calcCommissionSplit({ price: 500000, commissionPercent: 5, closingCostPercent: 2, repairsCredit: 3000 });
  assert.equal(r.costs.closing, 10000);
  assert.equal(r.netToSeller, 500000 - 25000 - 10000 - 3000);
});

test('佣金拆分：比例越界抛错', () => {
  assert.throws(() => calcCommissionSplit({ price: 100000, commissionPercent: 120 }), RangeError);
  assert.throws(() => calcCommissionSplit({ price: 100000, commissionPercent: 5, agentSplitPercent: 101 }), RangeError);
});

test('确定性：同输入两次结果一致', () => {
  const args = { price: 333333, annualRatePercent: 4.75, years: 20 };
  assert.deepEqual(calcMortgage(args), calcMortgage(args));
  assert.deepEqual(simulateLoanPayoff({ balance: 9999, annualRatePercent: 6, monthlyPayment: 300 }), simulateLoanPayoff({ balance: 9999, annualRatePercent: 6, monthlyPayment: 300 }));
});
