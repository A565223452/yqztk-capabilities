/**
 * units/craft 测试
 * 重点是 [F2] 的滴数守恒：三部分之和必须恒等于总滴数，任何四舍五入都不能破坏它。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertCrochetHook,
  mixModelPaint,
  mixNailPolish,
  planHairColor,
  parseHex,
  rgbToHex,
  mixRgb,
  CROCHET_HOOKS,
} from '../src/units/craft.mjs';

test('钩针换算：三种查询方式结果一致', () => {
  const byUs = convertCrochetHook({ us: 'H' });
  const byUk = convertCrochetHook({ uk: '8' });
  const byMm = convertCrochetHook({ mm: 5.0 });
  for (const r of [byUs, byUk, byMm]) {
    assert.equal(r.found, true);
    assert.equal(r.us, 'H');
    assert.equal(r.uk, '8');
    assert.equal(r.mm, 5.0);
  }
});

test('钩针换算：大小写不敏感', () => {
  assert.equal(convertCrochetHook({ us: 'h' }).mm, 5.0);
});

test('钩针换算：未命中时返回 nearest 而不是空', () => {
  const r = convertCrochetHook({ mm: 5.2 });
  assert.equal(r.found, false);
  assert.ok(r.nearest, '应给出最接近的型号');
  assert.equal(r.nearest.mm, 5.0);
});

test('钩针换算：非法输入抛错', () => {
  assert.throws(() => convertCrochetHook({}), RangeError);
  assert.throws(() => convertCrochetHook({ mm: -1 }), RangeError);
});

test('钩针表本身自洽：每项的 mm 都可反查到自身', () => {
  for (const h of CROCHET_HOOKS) {
    const r = convertCrochetHook({ mm: h.mm });
    assert.equal(r.mm, h.mm, `mm=${h.mm} 反查失败`);
  }
});

test('[F2] 模型漆滴数守恒：任意组合下三部分之和 = 总滴数', () => {
  const cases = [
    { totalDrops: 20, baseRatio: 1, mixRatio: 1, thinner: 0 },
    { totalDrops: 20, baseRatio: 1, mixRatio: 1, thinner: 0.2 },
    { totalDrops: 7, baseRatio: 1, mixRatio: 2, thinner: 0 },
    { totalDrops: 3, baseRatio: 1, mixRatio: 1, thinner: 0.5 },
    { totalDrops: 100, baseRatio: 3, mixRatio: 7, thinner: 0.33 },
    { totalDrops: 1, baseRatio: 1, mixRatio: 0, thinner: 0 },
  ];
  for (const c of cases) {
    const r = mixModelPaint(c);
    assert.equal(
      r.baseDrops + r.mixDrops + r.thinnerDrops,
      c.totalDrops,
      `滴数不守恒：${JSON.stringify(c)} → ${JSON.stringify(r)}`
    );
    assert.equal(r.balanced, true);
  }
});

test('模型漆：稀释剂按总滴数计算，比例按剩余滴数分配', () => {
  const r = mixModelPaint({ totalDrops: 20, baseRatio: 1, mixRatio: 1, thinner: 0.2 });
  assert.equal(r.thinnerDrops, 4);
  assert.equal(r.baseDrops + r.mixDrops, 16);
  assert.equal(r.ratio, '1:1');
});

test('模型漆：比例 3:7 时分配接近 3:7', () => {
  const r = mixModelPaint({ totalDrops: 100, baseRatio: 3, mixRatio: 7, thinner: 0 });
  assert.equal(r.baseDrops, 30);
  assert.equal(r.mixDrops, 70);
});

test('模型漆：提供颜色时给出线性混合结果', () => {
  const r = mixModelPaint({ totalDrops: 10, baseRatio: 1, mixRatio: 1, baseHex: '#ffffff', mixHex: '#000000' });
  assert.equal(r.colors.mixMode, 'linear');
  assert.match(r.colors.mixed, /^#[0-9a-f]{6}$/);
});

test('模型漆：非法输入抛错', () => {
  assert.throws(() => mixModelPaint({ totalDrops: 0 }), RangeError);
  assert.throws(() => mixModelPaint({ totalDrops: 10, baseRatio: 0, mixRatio: 0 }), RangeError);
  assert.throws(() => mixModelPaint({ totalDrops: 10, thinner: 2 }), RangeError);
});

test('颜色基础工具：hex 解析与反向', () => {
  assert.deepEqual(parseHex('#336699'), { r: 0x33, g: 0x66, b: 0x99 });
  assert.deepEqual(parseHex('#369'), { r: 0x33, g: 0x66, b: 0x99 });
  assert.equal(rgbToHex(51, 102, 153), '#336699');
});

test('甲油调色：50/50 得到两色中点', () => {
  const r = mixNailPolish({ color1: '#ff0000', color2: '#0000ff', ratio: 0.5 });
  assert.equal(r.mixedHex, '#800080');
  assert.equal(r.gradient.length, 7);
  assert.equal(r.gradient[0].hex, '#ff0000');
  assert.equal(r.gradient[6].hex, '#0000ff');
});

test('甲油调色：极端比例退化为纯色', () => {
  assert.equal(mixNailPolish({ color1: '#ff0000', color2: '#0000ff', ratio: 1 }).mixedHex, '#ff0000');
  assert.equal(mixNailPolish({ color1: '#ff0000', color2: '#0000ff', ratio: 0 }).mixedHex, '#0000ff');
});

test('甲油调色：ratio 越界抛错', () => {
  assert.throws(() => mixNailPolish({ color1: '#fff000', color2: '#000fff', ratio: 2 }), RangeError);
});

test('mixRgb 分量被夹紧在 0~255', () => {
  const r = mixRgb({ r: 300, g: -20, b: 100 }, { r: 0, g: 0, b: 0 }, 1);
  assert.equal(r.r, 255);
  assert.equal(r.g, 0);
});

test('染发：色阶提升量决定开发剂体积', () => {
  assert.equal(planHairColor({ startLevel: 5, targetLevel: 5 }).developerVolume, 10, '不提升用 10 Vol');
  assert.equal(planHairColor({ startLevel: 5, targetLevel: 6 }).developerVolume, 10);
  assert.equal(planHairColor({ startLevel: 5, targetLevel: 7 }).developerVolume, 20);
  assert.equal(planHairColor({ startLevel: 5, targetLevel: 8 }).developerVolume, 30);
  assert.equal(planHairColor({ startLevel: 5, targetLevel: 9 }).developerVolume, 40);
});

test('染发：方向与告警', () => {
  assert.equal(planHairColor({ startLevel: 5, targetLevel: 5 }).direction, 'tone');
  assert.equal(planHairColor({ startLevel: 7, targetLevel: 5 }).direction, 'deposit');
  assert.equal(planHairColor({ startLevel: 5, targetLevel: 8 }).direction, 'lift');
  assert.ok(planHairColor({ startLevel: 5, targetLevel: 9 }).warnings.length > 0, '大幅提色应有告警');
});

test('染发：色阶越界抛错', () => {
  assert.throws(() => planHairColor({ startLevel: 0, targetLevel: 5 }), RangeError);
  assert.throws(() => planHairColor({ startLevel: 5, targetLevel: 11 }), RangeError);
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(mixModelPaint({ totalDrops: 17, baseRatio: 2, mixRatio: 3 }), mixModelPaint({ totalDrops: 17, baseRatio: 2, mixRatio: 3 }));
  assert.deepEqual(mixNailPolish({ color1: '#123456', color2: '#abcdef', ratio: 0.3 }), mixNailPolish({ color1: '#123456', color2: '#abcdef', ratio: 0.3 }));
});
