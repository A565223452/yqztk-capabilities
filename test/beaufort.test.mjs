/**
 * weather/beaufort 的能力测试
 * 关键是 [F1]：高风段必须命中标准等级，不能被低估一级。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beaufortFromSpeed, beaufortFromMetersPerSecond, CAPABILITY } from '../src/weather/beaufort.mjs';

test('低风段与标准一致', () => {
  assert.equal(beaufortFromSpeed(0).force, 0);
  assert.equal(beaufortFromSpeed(2).force, 1);
  assert.equal(beaufortFromSpeed(6).force, 2);
  assert.equal(beaufortFromSpeed(10).force, 3);
  assert.equal(beaufortFromSpeed(15).force, 4);
  assert.equal(beaufortFromSpeed(20).force, 5);
  assert.equal(beaufortFromSpeed(28).force, 6);
});

test('[F1] 高风段命中标准等级（站点实现会低估一级）', () => {
  // 60 mph = 26.82 m/s → 标准 24.5–28.4 → Force 10
  assert.equal(beaufortFromSpeed(60, 'mph').force, 10, '60 mph 应为 Force 10');
  // 70 mph = 31.29 m/s → 标准 28.5–32.6 → Force 11
  assert.equal(beaufortFromSpeed(70, 'mph').force, 11, '70 mph 应为 Force 11');
  // 80 mph = 35.76 m/s → ≥32.7 → Force 12
  assert.equal(beaufortFromSpeed(80, 'mph').force, 12, '80 mph 应为 Force 12');
});

test('[证据] 站点原实现的阈值确实把飓风级风速低估一级', () => {
  const legacyForce = (mph) =>
    mph < 1 ? 0 : mph < 4 ? 1 : mph < 8 ? 2 : mph < 13 ? 3 : mph < 19 ? 4 : mph < 25 ? 5 :
    mph < 32 ? 6 : mph < 40 ? 7 : mph < 50 ? 8 : mph < 62 ? 9 : mph < 74 ? 10 : mph < 84 ? 11 : 12;
  assert.equal(legacyForce(60), 9, '旧实现报 9（标准 10）');
  assert.equal(legacyForce(70), 10, '旧实现报 10（标准 11）');
  assert.equal(legacyForce(80), 11, '旧实现报 11（标准 12）');
});

test('m/s 标准区间边界精确（GB/T 28591-2012）', () => {
  const at = (ms) => beaufortFromMetersPerSecond(ms).force;
  assert.equal(at(0.29), 0);
  assert.equal(at(0.3), 1);
  assert.equal(at(1.59), 1);
  assert.equal(at(1.6), 2);
  assert.equal(at(3.39), 2);
  assert.equal(at(3.4), 3);
  assert.equal(at(24.49), 9);
  assert.equal(at(24.5), 10);
  assert.equal(at(28.49), 10);
  assert.equal(at(28.5), 11);
  assert.equal(at(32.69), 11);
  assert.equal(at(32.7), 12);
  assert.equal(at(100), 12);
});

test('四种输入单位换算一致（同一风速不同单位必须同级）', () => {
  const ms = 26.8224; // = 60 mph
  assert.equal(beaufortFromSpeed(60, 'mph').force, beaufortFromSpeed(ms, 'ms').force);
  assert.equal(beaufortFromSpeed(ms * 3.6, 'kmh').force, beaufortFromSpeed(ms, 'ms').force);
  assert.equal(beaufortFromSpeed(ms / 0.514444, 'knots').force, beaufortFromSpeed(ms, 'ms').force);
});

test('返回多单位折算值，且互相自洽', () => {
  const r = beaufortFromSpeed(100, 'kmh');
  assert.equal(r.input.unit, 'kmh');
  assert.ok(Math.abs(r.metersPerSecond - 27.78) < 0.01);
  assert.ok(Math.abs(r.mph - 62.14) < 0.05);
  assert.ok(Math.abs(r.knots - 54.0) < 0.1);
  assert.equal(r.force, 10);
});

test('[F2] 返回本级区间边界（上界为不含）', () => {
  const r = beaufortFromSpeed(60, 'mph');
  assert.equal(r.rangeInInputUnit.unit, 'mph');
  assert.ok(r.rangeInInputUnit.lower < 60);
  assert.ok(r.rangeInInputUnit.upperExclusive > 60);
});

test('最高等级给出「不再细分」的提示，且上界为 null 而不是 Infinity', () => {
  const r = beaufortFromSpeed(200, 'mph');
  assert.equal(r.force, 12);
  assert.equal(r.rangeInInputUnit.upperExclusive, null);
  assert.ok(r.warnings.some((w) => w.includes('最高等级')));
});

test('包含完整 12 级对照表', () => {
  const r = beaufortFromSpeed(10);
  assert.equal(r.reference.length, 13); // 0–12
  assert.equal(r.reference[12].msRange[1], null);
});

test('名称为英文、中文双语（站点为英文站，中文为增值字段）', () => {
  const r = beaufortFromSpeed(80, 'mph');
  assert.equal(r.name, 'Hurricane');
  assert.equal(r.nameZh, '台风/飓风');
});

test('失败边界明确', () => {
  assert.throws(() => beaufortFromSpeed(-1), RangeError);
  assert.throws(() => beaufortFromSpeed('fast'), RangeError);
  assert.throws(() => beaufortFromSpeed(10, 'furlongs'), RangeError);
  assert.throws(() => beaufortFromMetersPerSecond(-0.1), RangeError);
});

test('确定性：同一输入两次结果完全一致', () => {
  assert.deepEqual(beaufortFromSpeed(47.5, 'mph'), beaufortFromSpeed(47.5, 'mph'));
});

test('声明所用标准', () => {
  assert.ok(CAPABILITY.standard.includes('GB/T 28591'));
});
