/**
 * health/bmi 的能力测试
 * 重点：分级边界一个不漏、单位换算可复核、不接收无必要字段、极端值有告警。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBMI, CAPABILITY } from '../src/health/bmi.mjs';

test('公制：身高 1 m 时 BMI 数值等于体重公斤数（便于精确验证边界）', () => {
  const r = computeBMI({ height: 100, weight: 70 });
  assert.equal(r.bmi, 70);
});

test('英制公式与站点一致：72 in / 180 lb → BMI 24.4', () => {
  // 703 * 180 / 72^2 = 126540 / 5184 = 24.4097... → 24.4
  const r = computeBMI({ height: 72, weight: 180, unit: 'imperial' });
  assert.equal(r.bmi, 24.4);
  assert.equal(r.categoryKey, 'normal');
});

test('WHO 分级边界逐个验证（<18.5 / <25 / <30 / <35 / <40）', () => {
  const at = (bmiValue) => computeBMI({ height: 100, weight: bmiValue }).categoryKey;
  assert.equal(at(18.4), 'underweight');
  assert.equal(at(18.5), 'normal', '18.5 必须归入正常，不能落到偏瘦');
  assert.equal(at(24.9), 'normal');
  assert.equal(at(25), 'overweight', '25 必须归入超重');
  assert.equal(at(29.9), 'overweight');
  assert.equal(at(30), 'obese-1');
  assert.equal(at(34.9), 'obese-1');
  assert.equal(at(35), 'obese-2');
  assert.equal(at(39.9), 'obese-2');
  assert.equal(at(40), 'obese-3');
});

test('BMI 保留一位小数，且不因浮点产生 .x999 类噪声', () => {
  const r = computeBMI({ height: 175, weight: 70 });
  // 70 / 1.75^2 = 22.857142... → 22.9
  assert.equal(r.bmi, 22.9);
  assert.equal(String(r.bmi).split('.')[1].length <= 1, true);
});

test('理想体重区间：公制 18.5–24.9 取整', () => {
  const r = computeBMI({ height: 100, weight: 70 });
  assert.deepEqual(r.idealWeightRange, { low: 19, high: 25, unit: 'kg' });
});

test('理想体重区间：英制换算为磅（系数 0.453592，与站点一致）', () => {
  const r = computeBMI({ height: 72, weight: 180, unit: 'imperial' });
  assert.deepEqual(r.idealWeightRange, { low: 136, high: 184, unit: 'lb' });
});

test('[F1] 不接受 age / gender：传入也不影响结果，且能力显式声明拒绝', () => {
  const base = computeBMI({ height: 175, weight: 70 });
  const withExtra = computeBMI({ height: 175, weight: 70, age: 30, gender: 'male' });
  assert.equal(withExtra.bmi, base.bmi);
  assert.equal(withExtra.categoryKey, base.categoryKey);
  assert.deepEqual(CAPABILITY.rejectedInputs.includes('age'), true);
  assert.deepEqual(CAPABILITY.rejectedInputs.includes('gender'), true);
});

test('[F2] 极端但为正的输入给出 warning，同时保留计算', () => {
  const r = computeBMI({ height: 300, weight: 70 });
  assert.equal(r.bmi > 0, true);
  assert.ok(r.warnings.some((w) => w.includes('超出常见生理范围')));
});

test('[F2] 体重同样有范围告警', () => {
  const r = computeBMI({ height: 175, weight: 800 });
  assert.ok(r.warnings.some((w) => w.includes('体重')));
});

test('失败边界明确：非法输入抛 RangeError 而不是静默变成 0', () => {
  assert.throws(() => computeBMI({ height: 0, weight: 70 }), RangeError);
  assert.throws(() => computeBMI({ height: -1, weight: 70 }), RangeError);
  assert.throws(() => computeBMI({ height: 175, weight: 0 }), RangeError);
  assert.throws(() => computeBMI({ height: 'tall', weight: 70 }), RangeError);
  assert.throws(() => computeBMI({}), RangeError);
  assert.throws(() => computeBMI({ height: 175, weight: 70, unit: 'stone' }), RangeError);
});

test('返回适用性声明，避免被当成医疗结论', () => {
  const r = computeBMI({ height: 175, weight: 70 });
  assert.ok(r.applicability.some((x) => x.includes('不构成医疗建议')));
  assert.ok(r.applicability.some((x) => x.includes('运动员')));
});

test('确定性：同一输入两次结果完全一致', () => {
  const args = { height: 168.5, weight: 61.2 };
  assert.deepEqual(computeBMI(args), computeBMI(args));
});

test('零依赖：模块无任何 import', async () => {
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/health/bmi.mjs', import.meta.url), 'utf8')
  );
  const imports = [...src.matchAll(/^\s*import\s.+?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, []);
});
