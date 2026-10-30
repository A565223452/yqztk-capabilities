/**
 * finance/amortization 的能力测试
 * 核心是把三条恒等式钉死：Σ本金 = 本金、Σ利息 = 利息总额、末期余额 = 0。
 * 只要实现里出现浮点累减或丢掉末期调整，这些断言必须转红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, monthlyPayment } from '../src/finance/amortization.mjs';

const cents = (x) => Math.round(x * 100);

test('经典值：100000 元 / 6% / 30 年 → 月供 599.55', () => {
  const r = buildSchedule({ principal: 100000, annualRatePercent: 6, months: 360 });
  assert.equal(r.monthlyPayment, 599.55);
  assert.equal(r.schedule.length, 360);
});

test('三条恒等式全部成立（这是财务能力的核心承诺）', () => {
  const r = buildSchedule({ principal: 100000, annualRatePercent: 6, months: 360 });
  assert.equal(r.identities.principalClosed, true, 'Σ本金必须等于原始本金');
  assert.equal(r.identities.balanceZero, true, '末期余额必须为零');
  assert.equal(r.identities.interestMatches, true, 'Σ利息必须等于还款总额减本金');
  assert.deepEqual(r.warnings, []);
});

test('Σ每期还款额 = 还款总额（精确到分）', () => {
  const r = buildSchedule({ principal: 250000, annualRatePercent: 4.5, months: 240 });
  const sum = r.schedule.reduce((s, x) => s + cents(x.payment), 0);
  assert.equal(sum, cents(r.totals.payments));
});

test('Σ每期本金 = 原始本金（精确到分，非近似）', () => {
  const r = buildSchedule({ principal: 99999.99, annualRatePercent: 7.25, months: 60 });
  const sum = r.schedule.reduce((s, x) => s + cents(x.principal), 0);
  assert.equal(sum, cents(99999.99));
});

test('[F1] 0% 利率可正常计算（站点实现在这里直接返回空白）', () => {
  const r = buildSchedule({ principal: 12000, annualRatePercent: 0, months: 12 });
  assert.equal(r.monthlyPayment, 1000);
  assert.equal(r.totals.interest, 0);
  assert.equal(r.identities.balanceZero, true);
  assert.equal(r.identities.principalClosed, true);
});

test('[F1] 0% 利率且本金不能整除时，仍有末期调整兜底', () => {
  const r = buildSchedule({ principal: 1000, annualRatePercent: 0, months: 3 });
  assert.equal(r.identities.balanceZero, true);
  assert.equal(r.identities.principalClosed, true);
});

test('[F3] 末期余额精确归零（含小数本金）', () => {
  const r = buildSchedule({ principal: 123456.78, annualRatePercent: 5.15, months: 84 });
  assert.equal(r.schedule.at(-1).balance, 0);
});

test('[F3] 末期还款额与常规月供不同（证明末期调整确实生效）', () => {
  const r = buildSchedule({ principal: 100000, annualRatePercent: 6.5, months: 47 });
  const last = r.schedule.at(-1).payment;
  assert.notEqual(last, r.monthlyPayment, '末期应被调整以结清余额');
});

test('[F4] 每一期余额单调不增，且不出现负余额', () => {
  const r = buildSchedule({ principal: 80000, annualRatePercent: 3.9, months: 120 });
  let prev = Infinity;
  for (const row of r.schedule) {
    assert.ok(row.balance >= 0, `第 ${row.period} 期余额为负`);
    assert.ok(row.balance < prev, `第 ${row.period} 期余额未下降`);
    prev = row.balance;
  }
});

test('第一期利息 = 本金 × 月利率（四舍五入到分）', () => {
  const r = buildSchedule({ principal: 100000, annualRatePercent: 6, months: 360 });
  assert.equal(cents(r.schedule[0].interest), Math.round(cents(100000) * (0.06 / 12)));
});

test('月供随利率单调递增、随期数单调递减', () => {
  assert.ok(monthlyPayment(100000, 6, 360) > monthlyPayment(100000, 3, 360));
  assert.ok(monthlyPayment(100000, 6, 360) < monthlyPayment(100000, 6, 180));
});

test('失败边界明确：非法输入抛 RangeError 而不是静默返回空', () => {
  assert.throws(() => buildSchedule({ principal: 0, annualRatePercent: 5, months: 12 }), RangeError);
  assert.throws(() => buildSchedule({ principal: -1, annualRatePercent: 5, months: 12 }), RangeError);
  assert.throws(() => buildSchedule({ principal: 1000, annualRatePercent: -1, months: 12 }), RangeError);
  assert.throws(() => buildSchedule({ principal: 1000, annualRatePercent: 5, months: 12.5 }), RangeError);
  assert.throws(() => buildSchedule({ principal: 1000, annualRatePercent: 5, months: 0 }), RangeError);
  assert.throws(() => buildSchedule({ principal: 1000, annualRatePercent: 5, months: 2000 }), RangeError);
  assert.throws(() => buildSchedule({}), RangeError);
});

test('确定性：连续两次调用结果完全一致', () => {
  const args = { principal: 333333.33, annualRatePercent: 4.75, months: 180 };
  assert.deepEqual(buildSchedule(args), buildSchedule(args));
});

test('本金越小、期数越短，利息总额越小', () => {
  const a = buildSchedule({ principal: 50000, annualRatePercent: 6, months: 60 }).totals.interest;
  const b = buildSchedule({ principal: 50000, annualRatePercent: 6, months: 120 }).totals.interest;
  assert.ok(b > a);
});

test('零依赖声明：能力模块不引用任何外部包', async () => {
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/finance/amortization.mjs', import.meta.url), 'utf8')
  );
  const imports = [...src.matchAll(/^\s*import\s.+?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, [], 'finance/amortization 不得有任何 import');
});
