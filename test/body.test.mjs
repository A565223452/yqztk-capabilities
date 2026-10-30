/**
 * health/body 测试
 * 重点是 [F1]（生理性别必须显式且合法）与 [F3]（体型分类可单独核对）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateBAC, analyzeBodyMeasurements, BAC_DISCLAIMER } from '../src/health/body.mjs';

test('BAC：70 kg 男性 2 标准杯 1 小时 → 约 0.04%', () => {
  // (2 × 14 × 100) / (70 × 1000 × 0.73) = 0.0548；再减 0.015 = 0.0398
  const r = estimateBAC({ weight: 70, drinks: 2, hours: 1, biologicalSex: 'male' });
  assert.equal(r.peakBAC, 0.055);
  assert.equal(r.currentBAC, 0.04);
  assert.equal(r.level, 'mild');
});

test('BAC：女性系数更高，同等条件下 BAC 更高', () => {
  const male = estimateBAC({ weight: 60, drinks: 2, hours: 0, biologicalSex: 'male' });
  const female = estimateBAC({ weight: 60, drinks: 2, hours: 0, biologicalSex: 'female' });
  assert.ok(female.currentBAC > male.currentBAC);
  assert.equal(female.widmarkFactor, 0.66);
  assert.equal(male.widmarkFactor, 0.73);
});

test('BAC：时间推移会降低估算值，且不出现负数', () => {
  const early = estimateBAC({ weight: 80, drinks: 3, hours: 1, biologicalSex: 'male' });
  const later = estimateBAC({ weight: 80, drinks: 3, hours: 5, biologicalSex: 'male' });
  assert.ok(later.currentBAC < early.currentBAC);
  const veryLate = estimateBAC({ weight: 80, drinks: 1, hours: 20, biologicalSex: 'male' });
  assert.equal(veryLate.currentBAC, 0);
});

test('BAC：磅转公斤', () => {
  const kg = estimateBAC({ weight: 70, drinks: 2, hours: 0, biologicalSex: 'male' });
  const lb = estimateBAC({ weight: 70 / 0.453592, weightUnit: 'lbs', drinks: 2, hours: 0, biologicalSex: 'male' });
  assert.equal(kg.currentBAC, lb.currentBAC);
});

test('[F1] biologicalSex 必须显式提供合法值（不再默认落到男性）', () => {
  assert.throws(() => estimateBAC({ weight: 70, drinks: 2 }), /biologicalSex/);
  assert.throws(() => estimateBAC({ weight: 70, drinks: 2, biologicalSex: 'other' }), /biologicalSex/);
  assert.throws(() => estimateBAC({ weight: 70, drinks: 2, biologicalSex: '' }), /biologicalSex/);
});

test('[F2] 逐字段校验并指名，而不是把所有错误都变成「请输入有效值」', () => {
  assert.throws(() => estimateBAC({ weight: 0, drinks: 2, biologicalSex: 'male' }), /weight/);
  assert.throws(() => estimateBAC({ weight: 70, drinks: 0, biologicalSex: 'male' }), /drinks/);
  assert.throws(() => estimateBAC({ weight: 70, drinks: 2, hours: -1, biologicalSex: 'male' }), /hours/);
});

test('BAC：达到法定限值时给出对应等级', () => {
  const r = estimateBAC({ weight: 50, drinks: 5, hours: 0, biologicalSex: 'female' });
  assert.equal(r.level, 'legally-impaired');
  assert.ok(r.warnings.some((w) => w.includes('法定')));
});

test('BAC：必带免责声明，且明确不可用于驾驶判断', () => {
  const r = estimateBAC({ weight: 70, drinks: 1, biologicalSex: 'male' });
  assert.equal(r.disclaimer, BAC_DISCLAIMER);
  assert.ok(r.disclaimer.includes('不得用于判断是否适合驾驶'));
});

test('BAC：返回归零所需小时数', () => {
  const r = estimateBAC({ weight: 70, drinks: 2, hours: 0, biologicalSex: 'male' });
  assert.ok(r.hoursUntilZero > 0);
  // 归零时间应基于未取整的 currentBAC 计算，因此与「取整后反算」会有极小差异
  const approx = r.currentBAC / 0.015;
  assert.ok(Math.abs(r.hoursUntilZero - approx) < 0.02, `偏差过大：${r.hoursUntilZero} vs ${approx}`);
});

test('围度：BMI 与分级', () => {
  const r = analyzeBodyMeasurements({ biologicalSex: 'female', heightCm: 165, weightKg: 58, bustCm: 88, waistCm: 66, hipsCm: 94 });
  // 58 / 1.65^2 = 21.3
  assert.equal(r.bmi.value, 21.3);
  assert.equal(r.bmi.category, 'normal');
  assert.ok(r.bmi.healthyRangeKg.low > 50 && r.bmi.healthyRangeKg.high < 68);
});

test('围度：腰臀比与 WHO 风险分层', () => {
  const low = analyzeBodyMeasurements({ biologicalSex: 'female', heightCm: 165, weightKg: 55, bustCm: 86, waistCm: 66, hipsCm: 94 });
  assert.equal(low.waistToHip.ratio, 0.7);
  assert.equal(low.waistToHip.risk, 'low');
  const high = analyzeBodyMeasurements({ biologicalSex: 'male', heightCm: 175, weightKg: 95, bustCm: 105, waistCm: 105, hipsCm: 100 });
  assert.equal(high.waistToHip.risk, 'high');
});

test('[F3] 体型分类独立返回，可单独核对', () => {
  // hips > bust + 5 → pear
  const pear = analyzeBodyMeasurements({ biologicalSex: 'female', heightCm: 165, weightKg: 58, bustCm: 84, waistCm: 66, hipsCm: 94 });
  assert.equal(pear.bodyShape.key, 'pear');
  // 胸臀接近 + 腰细 → hourglass
  const hourglass = analyzeBodyMeasurements({ biologicalSex: 'female', heightCm: 170, weightKg: 60, bustCm: 90, waistCm: 68, hipsCm: 92 });
  assert.equal(hourglass.bodyShape.key, 'hourglass');
  // 腰围接近胸臀 → apple
  const apple = analyzeBodyMeasurements({ biologicalSex: 'female', heightCm: 165, weightKg: 75, bustCm: 96, waistCm: 90, hipsCm: 96 });
  assert.equal(apple.bodyShape.key, 'apple');
});

test('围度：BMI 进度百分比落在 0~100', () => {
  const r = analyzeBodyMeasurements({ biologicalSex: 'male', heightCm: 180, weightKg: 75, bustCm: 98, waistCm: 82, hipsCm: 96 });
  assert.ok(r.bmiScalePercent >= 0 && r.bmiScalePercent <= 100);
});

test('围度：必带「非临床诊断」说明', () => {
  const r = analyzeBodyMeasurements({ biologicalSex: 'male', heightCm: 180, weightKg: 75, bustCm: 98, waistCm: 82, hipsCm: 96 });
  assert.ok(r.warnings.some((w) => w.includes('不是临床诊断标准')));
});

test('围度：逐字段校验', () => {
  const ok = { biologicalSex: 'female', heightCm: 165, weightKg: 58, bustCm: 88, waistCm: 66, hipsCm: 94 };
  assert.throws(() => analyzeBodyMeasurements({ ...ok, biologicalSex: 'x' }), /biologicalSex/);
  assert.throws(() => analyzeBodyMeasurements({ ...ok, waistCm: 0 }), /waistCm/);
  assert.throws(() => analyzeBodyMeasurements({ ...ok, heightCm: 'tall' }), /heightCm/);
});

test('确定性：同输入两次结果一致', () => {
  const args = { biologicalSex: 'female', heightCm: 162, weightKg: 55, bustCm: 85, waistCm: 65, hipsCm: 90 };
  assert.deepEqual(analyzeBodyMeasurements(args), analyzeBodyMeasurements(args));
  assert.deepEqual(estimateBAC({ weight: 65, drinks: 2, hours: 1, biologicalSex: 'female' }), estimateBAC({ weight: 65, drinks: 2, hours: 1, biologicalSex: 'female' }));
});
