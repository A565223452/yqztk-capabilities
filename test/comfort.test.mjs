/**
 * weather/comfort 测试
 * 重点是 [F1]：必须明确回报用了哪条公式、以及各公式是否在适用区间内。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcApparentTemperature,
  heatIndexFahrenheit,
  windChillFahrenheit,
  vapourPressure,
  australianApparentFahrenheit,
} from '../src/weather/comfort.mjs';

test('热指数：典型高温高湿下高于气温', () => {
  // 95°F / 60% RH ≈ 113°F（NWS 参考值约 113）
  const hi = heatIndexFahrenheit(95, 60);
  assert.ok(hi > 95, `热指数应高于气温，实际 ${hi}`);
  assert.ok(Math.abs(hi - 113) < 4, `与参考值偏差过大：${hi}`);
});

test('热指数：相同气温下湿度越高体感越热', () => {
  const dry = heatIndexFahrenheit(95, 40);
  const humid = heatIndexFahrenheit(95, 80);
  assert.ok(humid > dry);
});

test('风寒：典型低温有风下低于气温', () => {
  // 30°F / 15 mph ≈ 19°F
  const wc = windChillFahrenheit(30, 15);
  assert.ok(wc < 30);
  assert.ok(Math.abs(wc - 19) < 2, `与参考值偏差过大：${wc}`);
});

test('风寒：风速越大体感越冷', () => {
  assert.ok(windChillFahrenheit(20, 30) < windChillFahrenheit(20, 10));
});

test('蒸汽压：随温度与湿度单调增加', () => {
  assert.ok(vapourPressure(90, 70) > vapourPressure(70, 70));
  assert.ok(vapourPressure(80, 90) > vapourPressure(80, 30));
});

test('澳式体感温度：有风时低于气温', () => {
  const at = australianApparentFahrenheit(80, 50, 10);
  assert.ok(at < 80);
});

test('[F1] 高温高湿走 heat-index，并标明适用性', () => {
  const r = calcApparentTemperature({ temperature: 35, humidityPercent: 70, windSpeed: 1 });
  assert.equal(r.method, 'heat-index');
  assert.equal(r.applicability.heatIndex.applicable, true);
  assert.equal(r.applicability.windChill.applicable, false);
});

test('[F1] 低温有风走 wind-chill', () => {
  const r = calcApparentTemperature({ temperature: 0, humidityPercent: 50, windSpeed: 10 });
  assert.equal(r.method, 'wind-chill');
  assert.equal(r.applicability.windChill.applicable, true);
  assert.equal(r.applicability.heatIndex.applicable, false);
});

test('[F1] 中间区间两条公式都不适用时走澳式公式并告警', () => {
  const r = calcApparentTemperature({ temperature: 18, humidityPercent: 50, windSpeed: 1 });
  assert.equal(r.method, 'australian-apparent');
  assert.ok(r.warnings.some((w) => w.includes('间隙区间')));
});

test('[F2] 高温但湿度不足时明确说明热指数不适用', () => {
  const r = calcApparentTemperature({ temperature: 30, humidityPercent: 20, windSpeed: 0 });
  assert.equal(r.applicability.heatIndex.applicable, false);
  assert.ok(r.warnings.some((w) => w.includes('湿度低于 40%')));
});

test('单位换算：摄氏与华氏得到同一体感结果', () => {
  const c = calcApparentTemperature({ temperature: 35, humidityPercent: 70, windSpeed: 2, outputUnit: 'C' });
  const f = calcApparentTemperature({ temperature: (35 * 9) / 5 + 32, temperatureUnit: 'F', humidityPercent: 70, windSpeed: 2, outputUnit: 'F' });
  assert.ok(Math.abs(c.apparent.celsius - f.apparent.celsius) < 0.1);
});

test('风速单位表：m/s 与 km/h 等价', () => {
  const a = calcApparentTemperature({ temperature: 10, windSpeed: 5, windUnit: 'ms' });
  const b = calcApparentTemperature({ temperature: 10, windSpeed: 18, windUnit: 'kmh' });
  assert.ok(Math.abs(a.normalized.windMps - b.normalized.windMps) < 0.01);
  assert.throws(() => calcApparentTemperature({ temperature: 10, windUnit: 'furlongs' }), RangeError);
});

test('太阳辐射修正是可选的显式项', () => {
  const noSun = calcApparentTemperature({ temperature: 30, humidityPercent: 60 });
  const sun = calcApparentTemperature({ temperature: 30, humidityPercent: 60, solarRadiationWm2: 500 });
  assert.equal(noSun.components.solarCorrectionF, 0);
  assert.equal(sun.components.solarCorrectionF, 10);
  assert.ok(sun.apparent.celsius > noSun.apparent.celsius);
  assert.ok(sun.warnings.some((w) => w.includes('太阳辐射')));
});

test('体感温度给出与实测的差值', () => {
  const r = calcApparentTemperature({ temperature: 35, humidityPercent: 80 });
  assert.ok(r.apparent.deltaFromActual.celsius > 0, '高温高湿应感觉更热');
});

test('体感温度分级', () => {
  assert.equal(calcApparentTemperature({ temperature: 42, humidityPercent: 80 }).interpretation, 'extreme-heat-danger');
  assert.equal(calcApparentTemperature({ temperature: -20, windSpeed: 15 }).interpretation, 'extreme-cold-danger');
});

test('非法输入抛错', () => {
  assert.throws(() => calcApparentTemperature({ temperature: 'hot' }), RangeError);
  assert.throws(() => calcApparentTemperature({ temperature: 20, humidityPercent: 200 }), RangeError);
  assert.throws(() => calcApparentTemperature({ temperature: 20, windSpeed: -1 }), RangeError);
  assert.throws(() => calcApparentTemperature({ temperature: 20, solarRadiationWm2: -1 }), RangeError);
});

test('必带「非决策依据」告警', () => {
  const r = calcApparentTemperature({ temperature: 25 });
  assert.ok(r.warnings.some((w) => w.includes('不构成高温作业或赛事安全的决策依据')));
});

test('确定性：同输入两次结果一致', () => {
  const args = { temperature: 28, humidityPercent: 65, windSpeed: 3, solarRadiationWm2: 200 };
  assert.deepEqual(calcApparentTemperature(args), calcApparentTemperature(args));
});
