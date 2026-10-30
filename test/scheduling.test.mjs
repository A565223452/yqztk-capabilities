/**
 * time/scheduling 测试
 * 重点是 [F1]（不受时区影响）与 [F2]（月末钳制）—— 这两条是站点实现里最容易出错的地方。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffDates, shiftDate, formatCountdown, estimateHikingTime, calcReadingTime } from '../src/time/scheduling.mjs';

test('日期差：1/1 → 3/15 共 73 天（闰年因素不含）', () => {
  const r = diffDates('2026-01-01', '2026-03-15');
  assert.equal(r.totalDays, 73);
  assert.equal(r.order, 'forward');
  assert.deepEqual(r.calendar, { years: 0, months: 2, days: 14 });
});

test('日期差：跨年与反向', () => {
  const r = diffDates('2024-01-01', '2025-01-01');
  assert.equal(r.totalDays, 366, '2024 是闰年');
  const back = diffDates('2025-03-01', '2025-01-01');
  assert.equal(back.order, 'backward');
  assert.equal(back.totalDays, 59);
});

test('日期差：同一天为 0', () => {
  const r = diffDates('2026-06-06', '2026-06-06');
  assert.equal(r.totalDays, 0);
  assert.deepEqual(r.calendar, { years: 0, months: 0, days: 0 });
});

test('日期差：周与余天', () => {
  const r = diffDates('2026-01-01', '2026-01-22');
  assert.equal(r.total.weeks, 3);
  assert.equal(r.total.remainderDays, 0);
  assert.equal(r.total.hours, 21 * 24);
});

test('日期差：非法日期抛错（含 2 月 30 日这类不存在日期）', () => {
  assert.throws(() => diffDates('2026-02-30', '2026-03-01'), RangeError);
  assert.throws(() => diffDates('2026/01/01', '2026-03-01'), RangeError);
  assert.throws(() => diffDates('not-a-date', '2026-03-01'), RangeError);
});

test('[F2] 月末钳制：1/31 + 1 月 = 2/28（而不是 JS 默认的 3/3）', () => {
  const r = shiftDate('2026-01-31', { amount: 1, unit: 'months' });
  assert.equal(r.result, '2026-02-28');
  assert.equal(r.clamped, true, '必须标记发生过钳制');
});

test('[F2] 闰年 1/31 + 1 月 = 2/29', () => {
  assert.equal(shiftDate('2024-01-31', { amount: 1, unit: 'months' }).result, '2024-02-29');
});

test('[F2] 不需要钳制时 clamped 为 false', () => {
  const r = shiftDate('2026-01-15', { amount: 1, unit: 'months' });
  assert.equal(r.result, '2026-02-15');
  assert.equal(r.clamped, false);
});

test('日期加减：天 / 周 / 年', () => {
  assert.equal(shiftDate('2026-03-01', { amount: 30, unit: 'days' }).result, '2026-03-31');
  assert.equal(shiftDate('2026-03-01', { amount: 2, unit: 'weeks' }).result, '2026-03-15');
  assert.equal(shiftDate('2026-03-01', { amount: 1, unit: 'years' }).result, '2027-03-01');
});

test('日期加减：反向操作', () => {
  assert.equal(shiftDate('2026-03-01', { amount: 1, unit: 'days', operator: 'subtract' }).result, '2026-02-28');
});

test('日期加减：非法输入抛错', () => {
  assert.throws(() => shiftDate('2026-01-01', { amount: 0, unit: 'days' }), RangeError);
  assert.throws(() => shiftDate('2026-01-01', { amount: 1, unit: 'hours' }), RangeError);
  assert.throws(() => shiftDate('2026-01-01', { amount: 1, unit: 'days', operator: 'plus' }), RangeError);
});

test('[F1] 日期运算不受运行环境时区影响（UTC 基准）', () => {
  // 用两个跨夏令时的日期，若按本地时区解析，天差会因 DST 少 1 天
  const r = diffDates('2026-03-01', '2026-11-01');
  assert.equal(r.totalDays, 245);
});

test('[F3] 倒计时必须显式传入 now，否则抛错', () => {
  assert.throws(() => formatCountdown('2026-12-31T00:00:00Z'), /必须显式提供 nowISO/);
});

test('倒计时：分解与显示格式', () => {
  const r = formatCountdown('2026-12-31T00:00:00Z', '2026-12-01T00:00:00Z');
  assert.equal(r.expired, false);
  assert.equal(r.breakdown.days, 30);
  assert.equal(r.display, '30d 00:00:00');
});

test('倒计时：已过期时 expired=true 且总量取绝对值', () => {
  const r = formatCountdown('2026-01-01T00:00:00Z', '2026-01-02T12:00:00Z');
  assert.equal(r.expired, true);
  assert.equal(r.breakdown.days, 1);
  assert.equal(r.breakdown.hours, 12);
});

test('倒计时：跨小时分钟秒的分解', () => {
  const r = formatCountdown('2026-01-01T03:04:05Z', '2026-01-01T00:00:00Z');
  assert.deepEqual(r.breakdown, { days: 0, hours: 3, minutes: 4, seconds: 5 });
});

test('徒步：平地 5 km 约 1 小时内（含休息与余量）', () => {
  const r = estimateHikingTime({ distanceKm: 5 });
  assert.ok(r.totalHours > 1 && r.totalHours < 1.6);
  assert.ok(r.components.baseHours === 1);
});

test('徒步：爬升会显著增加时间', () => {
  const flat = estimateHikingTime({ distanceKm: 10 }).totalHours;
  const hill = estimateHikingTime({ distanceKm: 10, elevationGainM: 1000 }).totalHours;
  assert.ok(hill > flat + 1.5);
});

test('徒步：体能修正与地形修正方向正确', () => {
  const avg = estimateHikingTime({ distanceKm: 10 }).totalHours;
  const slow = estimateHikingTime({ distanceKm: 10, fitness: 'slow' }).totalHours;
  const elite = estimateHikingTime({ distanceKm: 10, fitness: 'elite' }).totalHours;
  assert.ok(slow > avg && avg > elite);
  const rough = estimateHikingTime({ distanceKm: 10, terrain: 'rough' }).totalHours;
  assert.ok(rough > avg);
});

test('徒步：负重超 15 kg 后按每公斤 1% 增加', () => {
  const light = estimateHikingTime({ distanceKm: 10, packKg: 15 }).totalHours;
  const heavy = estimateHikingTime({ distanceKm: 10, packKg: 25 }).totalHours;
  assert.ok(heavy > light);
});

test('徒步：可关闭休息与安全余量以得到纯移动时间', () => {
  const pure = estimateHikingTime({ distanceKm: 10, includeBreaks: false, includeSafetyMargin: false });
  assert.equal(pure.totalHours, pure.components.afterModifiers);
});

test('徒步：补给估算', () => {
  const r = estimateHikingTime({ distanceKm: 20 });
  assert.ok(r.supplies.waterLiters > 0);
  assert.ok(r.supplies.calories > 0);
});

test('徒步：非法输入抛错', () => {
  assert.throws(() => estimateHikingTime({ distanceKm: 0 }), RangeError);
  assert.throws(() => estimateHikingTime({ distanceKm: 5, fitness: 'superhuman' }), RangeError);
  assert.throws(() => estimateHikingTime({ distanceKm: 5, terrain: 'lava' }), RangeError);
});

test('阅读时长：200 词/分钟，5 词 = 1 分钟（向上取整）', () => {
  const r = calcReadingTime({ text: 'one two three four five' });
  assert.equal(r.words, 5);
  assert.equal(r.reading.minutes, 1);
});

test('阅读时长：空文本返回 0 分钟而不是 1', () => {
  const r = calcReadingTime({ text: '' });
  assert.equal(r.words, 0);
  assert.equal(r.reading.minutes, 0);
  assert.ok(r.warnings.length > 0);
});

test('阅读时长：朗读比默读慢，时间更长', () => {
  const text = Array.from({ length: 300 }, () => 'word').join(' ');
  const r = calcReadingTime({ text });
  assert.equal(r.reading.minutes, 2);
  assert.ok(r.speaking.minutes > r.reading.minutes);
});

test('阅读时长：超过一小时显示小时', () => {
  const text = Array.from({ length: 13000 }, () => 'word').join(' ');
  const r = calcReadingTime({ text, readingWpm: 200 });
  assert.ok(r.reading.display.includes('hr'));
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(diffDates('2026-05-05', '2027-05-05'), diffDates('2026-05-05', '2027-05-05'));
  assert.deepEqual(estimateHikingTime({ distanceKm: 17.3, elevationGainM: 640 }), estimateHikingTime({ distanceKm: 17.3, elevationGainM: 640 }));
});
