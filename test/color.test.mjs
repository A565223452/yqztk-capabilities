/**
 * units/color 测试
 * 重点是 [F2]：往返转换必须可逆（站点把 h 取整后再反算，会丢精度）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor,
  hslToRgb,
  rgbToHex,
  rgbToHslFloat,
  rgbToHsv,
  relativeLuminance,
  contrastRatio,
  convertColor,
} from '../src/units/color.mjs';

test('parseColor 支持 hex 的 3 / 6 / 8 位写法', () => {
  assert.deepEqual(parseColor('#369'), { r: 0x33, g: 0x66, b: 0x99, a: 1 });
  assert.deepEqual(parseColor('#336699'), { r: 0x33, g: 0x66, b: 0x99, a: 1 });
  const withAlpha = parseColor('#33669980');
  assert.equal(withAlpha.a > 0.49 && withAlpha.a < 0.51, true);
});

test('parseColor 支持 rgb() / rgba() / hsl() / hsla()', () => {
  assert.deepEqual(parseColor('rgb(51, 102, 153)'), { r: 51, g: 102, b: 153, a: 1 });
  assert.equal(parseColor('rgba(51,102,153,0.5)').a, 0.5);
  assert.deepEqual(parseColor('hsl(210, 50%, 40%)'), { r: 51, g: 102, b: 153, a: 1 });
  assert.equal(parseColor('hsla(210,50%,40%,0.25)').a, 0.25);
});

test('parseColor 支持对象入参并夹紧分量', () => {
  assert.deepEqual(parseColor({ r: 300, g: -5, b: 128 }), { r: 255, g: 0, b: 128, a: 1 });
});

test('[F1] 无法解析的颜色抛错，而不是静默返回 null', () => {
  for (const bad of ['', '   ', 'not-a-color', '#12345', 'rgb(1,2)', null, undefined]) {
    assert.throws(() => parseColor(bad), RangeError, `应拒绝：${String(bad)}`);
  }
});

test('hslToRgb 端点上得到纯色', () => {
  assert.deepEqual(hslToRgb(0, 1, 0.5), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hslToRgb(120, 1, 0.5), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hslToRgb(240, 1, 0.5), { r: 0, g: 0, b: 255 });
});

test('饱和度为 0 时是灰度', () => {
  assert.deepEqual(hslToRgb(123, 0, 0.5), { r: 128, g: 128, b: 128 });
});

test('[F2] hex → hsl → hex 往返可逆（站点取整 h 后会丢精度）', () => {
  const samples = ['#336699', '#ff8800', '#0a0a0a', '#c0ffee', '#7f3fbf', '#123456'];
  for (const hex of samples) {
    const rgb = parseColor(hex);
    const hsl = rgbToHslFloat(rgb.r, rgb.g, rgb.b);
    const back = hslToRgb(hsl.h, hsl.s, hsl.l);
    assert.equal(rgbToHex(back), hex, `${hex} 往返失败 → ${rgbToHex(back)}`);
  }
});

test('rgbToHsv 与已知值一致', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  assert.equal(rgbToHsv(0, 0, 0).v, 0);
  assert.equal(rgbToHsv(255, 255, 255).s, 0);
});

test('相对亮度：黑 0、白 1', () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
});

test('WCAG 对比度：黑白为 21:1，同色为 1:1', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#336699', '#336699'), 1);
});

test('对比度计算与顺序无关', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), contrastRatio('#ffffff', '#000000'));
});

test('convertColor 输出各表示法与可访问性建议', () => {
  const r = convertColor('#336699');
  assert.equal(r.hex, '#336699');
  assert.deepEqual(r.rgb, { r: 51, g: 102, b: 153, a: 1 });
  assert.equal(r.rgbString, 'rgb(51, 102, 153)');
  assert.equal(r.hslString, 'hsl(210, 50%, 40%)');
  assert.equal(r.hsv.h, 210);
  assert.equal(r.contrast.bestTextColor, '#ffffff', '深色底应配白字');
  assert.equal(typeof r.contrast.wcagAA_normal, 'boolean');
});

test('convertColor 对浅色给出黑色文字建议', () => {
  assert.equal(convertColor('#ffeeee').contrast.bestTextColor, '#000000');
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(convertColor('#7f3fbf'), convertColor('#7f3fbf'));
});
