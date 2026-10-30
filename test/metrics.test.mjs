/**
 * business/metrics 测试
 * 重点是 [F1]（有限总体校正必须显式触发）与 [F3]（小费明细必须闭合）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcPollingMargin, calcMeetingCost, splitTip, calcAquariumStock, FISH_COMPATIBILITY } from '../src/business/metrics.mjs';

test('民调：n=1000、p=50%、95% → MoE 约 3.1%', () => {
  const r = calcPollingMargin({ sampleSize: 1000, percent: 50, confidenceLevel: 95 });
  assert.equal(r.marginOfError, 3.1);
  assert.deepEqual(r.interval, { lower: 46.9, upper: 53.1 });
});

test('民调：置信水平切换改变 MoE', () => {
  const r90 = calcPollingMargin({ sampleSize: 1000, confidenceLevel: 90 });
  const r99 = calcPollingMargin({ sampleSize: 1000, confidenceLevel: 99 });
  assert.ok(r90.marginOfError < r99.marginOfError);
});

test('[F1] 不传 population 就不应用有限总体校正', () => {
  const noPop = calcPollingMargin({ sampleSize: 500, percent: 50 });
  assert.equal(noPop.fpcApplied, false);
  // 用小总体让校正在 1 位小数的精度下也可见
  const withPop = calcPollingMargin({ sampleSize: 500, percent: 50, population: 2000 });
  assert.equal(withPop.fpcApplied, true);
  assert.ok(withPop.marginOfError < noPop.marginOfError, `校正后 MoE 应变小：${withPop.marginOfError} vs ${noPop.marginOfError}`);
});

test('民调：总体规模超过一千万时不校正', () => {
  const r = calcPollingMargin({ sampleSize: 1000, percent: 50, population: 50000000 });
  assert.equal(r.fpcApplied, false);
});

test('民调：显著性判断', () => {
  const sig = calcPollingMargin({ sampleSize: 1000, percent: 52, comparePercent: 45 });
  assert.equal(sig.comparison.significant, true);
  const tie = calcPollingMargin({ sampleSize: 1000, percent: 50, comparePercent: 49 });
  assert.equal(tie.comparison.significant, false);
});

test('民调：n 越小 MoE 越大；比例越接近 50% MoE 越大', () => {
  assert.ok(calcPollingMargin({ sampleSize: 100 }).marginOfError > calcPollingMargin({ sampleSize: 10000 }).marginOfError);
  assert.ok(calcPollingMargin({ sampleSize: 1000, percent: 50 }).marginOfError > calcPollingMargin({ sampleSize: 1000, percent: 5 }).marginOfError);
});

test('民调：非法输入抛错', () => {
  assert.throws(() => calcPollingMargin({ sampleSize: 0 }), RangeError);
  assert.throws(() => calcPollingMargin({ sampleSize: 100, confidenceLevel: 80 }), RangeError);
  assert.throws(() => calcPollingMargin({ sampleSize: 1000, population: 100 }), RangeError);
});

test('会议成本：6 人 × 12 万年薪 × 1 小时 = 346.15', () => {
  const r = calcMeetingCost({ people: 6, annualSalaryPerPerson: 120000, hours: 1 });
  assert.equal(r.costs.total, 346.15);
});

test('会议成本：间接成本与机会成本逐层作用', () => {
  const base = calcMeetingCost({ people: 4, annualSalaryPerPerson: 100000, hours: 2 });
  const loaded = calcMeetingCost({ people: 4, annualSalaryPerPerson: 100000, hours: 2, overheadMultiplier: 1.5 });
  assert.ok(loaded.costs.withOverhead > base.costs.withOverhead);
  // 4 × (100000/2080) × 2 = 384.615…；× 1.5 = 576.923 → 576.92（先乘后取整）
  assert.equal(loaded.costs.withOverhead, 576.92);
  const opp = calcMeetingCost({ people: 4, annualSalaryPerPerson: 100000, hours: 2, opportunityRate: 0.5 });
  assert.ok(opp.costs.opportunity > 0);
  assert.equal(opp.costs.total, Math.round((opp.costs.withOverhead + opp.costs.opportunity) * 100) / 100);
});

test('[F2] 等价周数由输入推导，可核对', () => {
  const r = calcMeetingCost({ people: 1, annualSalaryPerPerson: 208000, hours: 40 });
  // 时薪 100，40 小时 = 4000；每周 40 小时 → 1 周
  assert.equal(r.hourlyRatePerPerson, 100);
  assert.equal(r.equivalent.personWeeks, 1);
  assert.ok(r.equivalent.assumption.includes('40'));
});

test('会议成本：每分钟与人均成本', () => {
  const r = calcMeetingCost({ people: 5, annualSalaryPerPerson: 104000, hours: 1 });
  assert.equal(r.per.person, Math.round((r.costs.total / 5) * 100) / 100);
  assert.equal(r.per.minute, Math.round((r.costs.total / 60) * 100) / 100);
});

test('小费：100 + 8% 税 + 18% 小费 = 126', () => {
  const r = splitTip({ subtotal: 100, tipPercent: 18, taxPercent: 8 });
  assert.equal(r.subtotal, 100);
  assert.equal(r.tax.amount, 8);
  assert.equal(r.tip.amount, 18);
  assert.equal(r.total, 126);
});

test('[F3] 分项账单：小计与各分项小费分别累加', () => {
  const r = splitTip({
    items: [
      { name: 'A', amount: 30, tipPercent: 20 },
      { name: 'B', amount: 20, tipPercent: 10 },
    ],
    taxPercent: 10,
  });
  assert.equal(r.subtotal, 50);
  assert.equal(r.tip.amount, 8); // 6 + 2
  assert.equal(r.tax.amount, 5);
  assert.equal(r.total, 63);
});

test('[F3] 取整时 total 变动被记录在 adjustment 与 warnings 里', () => {
  const r = splitTip({ subtotal: 33.33, tipPercent: 18, rounding: 'nearest' });
  assert.equal(r.total, 39);
  assert.notEqual(r.rounding.adjustment, 0);
  assert.ok(r.warnings.some((w) => w.includes('取整')));
});

test('小费：均分时每人金额之和恒等于总额', () => {
  for (const people of [2, 3, 7]) {
    const r = splitTip({ subtotal: 100.01, tipPercent: 15, people });
    const sum = Math.round(r.perPerson.reduce((a, p) => a + p.amount, 0) * 100);
    assert.equal(sum, Math.round(r.total * 100), `${people} 人分摊不闭合`);
    assert.equal(r.balanced, true);
  }
});

test('小费：自定义分摊比例之和必须为 100%', () => {
  const ok = splitTip({ subtotal: 100, splitMode: 'custom', customSplit: [{ name: 'A', percent: 60 }, { name: 'B', percent: 40 }] });
  assert.equal(ok.perPerson.length, 2);
  assert.equal(ok.perPerson[0].amount, 60);
  assert.throws(() => splitTip({ subtotal: 100, splitMode: 'custom', customSplit: [{ name: 'A', percent: 60 }] }), RangeError);
  assert.throws(() => splitTip({ subtotal: 100, splitMode: 'custom' }), RangeError);
});

test('小费：非法输入抛错', () => {
  assert.throws(() => splitTip({ subtotal: -1 }), RangeError);
  assert.throws(() => splitTip({ subtotal: 10, people: 0 }), RangeError);
  assert.throws(() => splitTip({ subtotal: 10, rounding: 'floor' }), RangeError);
});

test('鱼缸：29 加仑养 6 条 1.5 英寸小鱼 → Safe', () => {
  const r = calcAquariumStock({ volume: 29, fishGroups: [{ type: 'tetra', sizeInches: 1.5, quantity: 6 }] });
  assert.equal(r.stocking.totalInches, 9);
  assert.equal(r.stocking.status, 'Safe');
});

test('鱼缸：超密度时状态为 Overstocked 并告警', () => {
  const r = calcAquariumStock({ volume: 10, fishGroups: [{ type: 'goldfish', sizeInches: 6, quantity: 4 }] });
  assert.equal(r.stocking.status, 'Overstocked');
  assert.ok(r.warnings.some((w) => w.includes('超出估算容量')));
});

test('鱼缸：体积单位换算（升 → 加仑）', () => {
  const gal = calcAquariumStock({ volume: 29, unit: 'gallons', fishGroups: [{ type: 'tetra', sizeInches: 1, quantity: 5 }] });
  const lit = calcAquariumStock({ volume: 29 * 3.785, unit: 'liters', fishGroups: [{ type: 'tetra', sizeInches: 1, quantity: 5 }] });
  assert.equal(gal.tank.gallons, lit.tank.gallons);
});

test('鱼缸：金鱼与热带鱼混养给出 incompatible 问题', () => {
  const r = calcAquariumStock({
    volume: 55,
    fishGroups: [
      { type: 'goldfish', sizeInches: 4, quantity: 2 },
      { type: 'tetra', sizeInches: 1.5, quantity: 6 },
    ],
  });
  assert.ok(r.compatibility.issues.some((i) => i.severity === 'incompatible'));
  assert.ok(r.compatibility.suggestions.some((s) => s.includes('金鱼')));
});

test('鱼缸：非法输入抛错', () => {
  assert.throws(() => calcAquariumStock({ volume: 0, fishGroups: [{ type: 'tetra', sizeInches: 1, quantity: 1 }] }), RangeError);
  assert.throws(() => calcAquariumStock({ volume: 10, fishGroups: [] }), RangeError);
  assert.throws(() => calcAquariumStock({ volume: 10, fishGroups: [{ type: 'tetra', sizeInches: 1, quantity: 1.5 }] }), RangeError);
});

test('鱼缸数据表：金鱼被标记为与其他热带鱼不相容', () => {
  assert.ok(FISH_COMPATIBILITY.goldfish.incompatible.includes('tetra'));
  assert.ok(FISH_COMPATIBILITY.goldfish.incompatible.includes('betta'));
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(calcPollingMargin({ sampleSize: 800, percent: 47 }), calcPollingMargin({ sampleSize: 800, percent: 47 }));
  assert.deepEqual(splitTip({ subtotal: 77.77, tipPercent: 18.5, people: 4 }), splitTip({ subtotal: 77.77, tipPercent: 18.5, people: 4 }));
});
