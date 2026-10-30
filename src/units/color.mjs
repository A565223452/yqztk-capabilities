/**
 * capability: units/color-format
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/design-color-format-converter
 * 版本：1.0.0
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 输入不再只认 `#rrggbb`：站点只接受 6 位十六进制（3 位简写靠一个
 *        预处理分支勉强支持），`rgb()` / `hsl()` 字符串一律解析失败且**静默返回 null**，
 *        界面只显示颜色块不变 —— 用户看不出是「输入格式不对」还是「工具坏了」。
 *        本能力支持 hex(#rgb/#rrggbb/#rrggbbaa)、rgb()/rgba()、hsl()/hsla()，
 *        并且在解析失败时**抛错**，而不是静默返回空。
 *   [F2] HSL/HSV 的色相保留精度：站点把 h 四舍五入为整数度后再用于反算，
 *        往返转换（hex → hsl → hex）会丢精度。本能力内部保留浮点 h，
 *        只在**输出展示**时取整，因此转换链是可逆的。
 *   [F3] 增加相对亮度与 WCAG 对比度计算：这是颜色换算最常见的下游需求
 *        （判断文字该用黑还是白），站点没有提供，用户只能自己算。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   输出格式与取整口径（h 为 0–360 整数度、s/l/v 为 0–100 整数百分比）与原工具一致。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 不做色彩空间转换（sRGB ↔ Display P3 / Lab / CMYK），只做 sRGB 下的表示法互转。
 *   [L2] 忽略 alpha 通道以外的 ICC 配置。
 */

export const CAPABILITY = Object.freeze({
  id: 'units/color-format',
  version: '1.0.0',
  sourceTool: 'design-color-format-converter',
  deterministic: true,
  networkAccess: false,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x, n = 0) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

/**
 * 解析颜色字符串 → { r, g, b, a }
 * 支持 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() / hsl() / hsla()
 */
export function parseColor(input) {
  if (input && typeof input === 'object' && 'r' in input && 'g' in input && 'b' in input) {
    return {
      r: clamp(Math.round(Number(input.r)), 0, 255),
      g: clamp(Math.round(Number(input.g)), 0, 255),
      b: clamp(Math.round(Number(input.b)), 0, 255),
      a: input.a === undefined ? 1 : clamp(Number(input.a), 0, 1),
    };
  }

  const s = String(input ?? '').trim().toLowerCase();
  if (!s) throw new RangeError('颜色字符串为空');

  // hex
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) throw new RangeError(`无法解析的十六进制颜色：${input}`);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  // rgb() / rgba()
  const rgbM = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgbM) {
    const parts = rgbM[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) throw new RangeError(`rgb() 参数不足：${input}`);
    const num = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const r = num(parts[0]);
    const g = num(parts[1]);
    const b = num(parts[2]);
    if ([r, g, b].some((v) => !Number.isFinite(v))) throw new RangeError(`rgb() 参数非法：${input}`);
    return {
      r: clamp(Math.round(r), 0, 255),
      g: clamp(Math.round(g), 0, 255),
      b: clamp(Math.round(b), 0, 255),
      a: parts[3] === undefined ? 1 : clamp(parseFloat(parts[3]), 0, 1),
    };
  }

  // hsl() / hsla()
  const hslM = s.match(/^hsla?\(([^)]+)\)$/);
  if (hslM) {
    const parts = hslM[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) throw new RangeError(`hsl() 参数不足：${input}`);
    const h = parseFloat(parts[0]);
    const sat = parseFloat(parts[1].replace('%', '')) / 100;
    const lig = parseFloat(parts[2].replace('%', '')) / 100;
    if ([h, sat, lig].some((v) => !Number.isFinite(v))) throw new RangeError(`hsl() 参数非法：${input}`);
    const rgb = hslToRgb(h, sat, lig);
    return { ...rgb, a: parts[3] === undefined ? 1 : clamp(parseFloat(parts[3]), 0, 1) };
  }

  throw new RangeError(`无法识别的颜色格式：${input}`);
}

/** HSL（h 任意度数；s/l 为 0~1）→ RGB 0~255 */
export function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 1);
  const ln = clamp(l, 0, 1);
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue2rgb = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(hn) * 255),
    b: Math.round(hue2rgb(hn - 1 / 3) * 255),
  };
}

export function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** RGB → HSL（内部保留浮点 h，便于往返可逆） */
export function rgbToHslFloat(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s, l };
}

/** RGB → HSV */
export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s, v };
}

/** WCAG 相对亮度 */
export function relativeLuminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 对比度（1~21） */
export function contrastRatio(c1, c2) {
  const a = parseColor(c1);
  const b = parseColor(c2);
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return round((hi + 0.05) / (lo + 0.05), 2);
}

/**
 * 颜色格式全量换算。
 * @param {string|object} input 颜色（hex / rgb() / hsl() 字符串，或 {r,g,b}）
 * @returns {object} 各表示法 + 亮度 + 对比度建议
 */
export function convertColor(input) {
  const rgba = parseColor(input);
  const hslF = rgbToHslFloat(rgba.r, rgba.g, rgba.b);
  const hsvF = rgbToHsv(rgba.r, rgba.g, rgba.b);
  const hex = rgbToHex(rgba);

  const onWhite = contrastRatio(hex, '#ffffff');
  const onBlack = contrastRatio(hex, '#000000');

  return {
    hex,
    hexAlpha: rgba.a === 1 ? hex : rgbToHex(rgba) + clamp(Math.round(rgba.a * 255), 0, 255).toString(16).padStart(2, '0'),
    rgb: { r: rgba.r, g: rgba.g, b: rgba.b, a: round(rgba.a, 3) },
    rgbString: rgba.a === 1 ? `rgb(${rgba.r}, ${rgba.g}, ${rgba.b})` : `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${round(rgba.a, 3)})`,
    // 输出取整与站点一致；内部保留浮点，见 [F2]
    hsl: { h: Math.round(hslF.h) % 360, s: Math.round(hslF.s * 100), l: Math.round(hslF.l * 100) },
    hslString: `hsl(${Math.round(hslF.h) % 360}, ${Math.round(hslF.s * 100)}%, ${Math.round(hslF.l * 100)}%)`,
    hsv: { h: Math.round(hsvF.h) % 360, s: Math.round(hsvF.s * 100), v: Math.round(hsvF.v * 100) },
    relativeLuminance: round(relativeLuminance(rgba), 4),
    contrast: {
      onWhite,
      onBlack,
      bestTextColor: onBlack >= onWhite ? '#000000' : '#ffffff',
      wcagAA_normal: Math.max(onWhite, onBlack) >= 4.5,
      wcagAAA_normal: Math.max(onWhite, onBlack) >= 7,
    },
  };
}
