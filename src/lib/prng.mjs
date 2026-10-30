/**
 * 确定性伪随机数发生器（零依赖）
 * ============================================================
 * 为什么能力层需要它：
 *   站点上有三个工具用了 `Math.random()`（lorem-ipsum 生成、密码生成、密室谜题生成）。
 *   这直接违反能力层的第一条约束 —— Deterministic。
 *   只要随机源不可控，「相同输入必得相同输出」就不成立，
 *   调用方无法复现一个 bug，也无法把结果写进测试。
 *
 *   本模块把随机变成**显式输入**：所有能力都要求调用方传入 seed。
 *   传相同 seed 必得相同结果；想换一批结果就换 seed。
 *
 * 算法：mulberry32 —— 32 位状态、周期 2^32、分布质量足够用于文案与密码占位，
 *      但**不适用于密码学用途**。需要密码学强度时，调用方应使用 node:crypto。
 */

/** 把任意 seed（数字或字符串）归一化为 32 位无符号整数。 */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed ?? '');
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * 创建一个确定性随机源。
 * @param {number|string} seed
 * @returns {() => number} 每次调用返回 [0, 1) 的浮点数
 */
export function createRng(seed) {
  let a = normalizeSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 闭区间 [min, max] 内的整数。 */
export function randomInt(rng, min, max) {
  if (!(max >= min)) throw new RangeError('randomInt: max 必须 >= min');
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** 从数组中取一个元素。 */
export function pickOne(rng, arr) {
  if (!Array.isArray(arr) || arr.length === 0) throw new RangeError('pickOne: 数组不能为空');
  return arr[randomInt(rng, 0, arr.length - 1)];
}

/**
 * Fisher–Yates 洗牌（返回新数组，不修改入参）。
 * 站点原实现用的是 `sort(() => Math.random() - 0.5)`，那不是一个正确的洗牌：
 * 比较函数的返回值不满足传递性，得到的分布有偏，且完全依赖 Math.random。
 */
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 按权重取一个下标（权重不需要归一化）。 */
export function weightedIndex(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new RangeError('weightedIndex: 权重和必须大于 0');
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
