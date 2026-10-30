/**
 * lib/prng 测试
 * 这是所有「生成类」能力的确定性基础：它错了，lorem / password / puzzle 全部不可复现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, normalizeSeed, randomInt, pickOne, shuffle, weightedIndex } from '../src/lib/prng.mjs';

test('相同 seed 必得相同序列（确定性的根）', () => {
  const a = createRng(42);
  const b = createRng(42);
  const sa = Array.from({ length: 20 }, () => a());
  const sb = Array.from({ length: 20 }, () => b());
  assert.deepEqual(sa, sb);
});

test('不同 seed 得到不同序列', () => {
  const a = createRng(1);
  const b = createRng(2);
  const sa = Array.from({ length: 10 }, () => a());
  const sb = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(sa, sb);
});

test('输出落在 [0, 1) 区间', () => {
  const rng = createRng('seed');
  for (let i = 0; i < 5000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `越界：${v}`);
  }
});

test('字符串 seed 与数字 seed 都被接受且稳定', () => {
  const s1 = createRng('alpha');
  const s2 = createRng('alpha');
  assert.equal(s1(), s2());
  assert.equal(typeof normalizeSeed('alpha'), 'number');
  assert.equal(normalizeSeed('alpha'), normalizeSeed('alpha'));
  assert.notEqual(normalizeSeed('alpha'), normalizeSeed('beta'));
});

test('randomInt 落在闭区间内且能取到两端', () => {
  const rng = createRng(7);
  let lo = false;
  let hi = false;
  for (let i = 0; i < 2000; i++) {
    const v = randomInt(rng, 1, 6);
    assert.ok(v >= 1 && v <= 6);
    if (v === 1) lo = true;
    if (v === 6) hi = true;
  }
  assert.ok(lo && hi, '两端都应能被取到');
});

test('randomInt 参数非法时抛错', () => {
  const rng = createRng(1);
  assert.throws(() => randomInt(rng, 5, 1), RangeError);
});

test('pickOne 空数组抛错，非空数组只在其中取值', () => {
  const rng = createRng(3);
  assert.throws(() => pickOne(rng, []), RangeError);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(pickOne(rng, arr)));
});

test('shuffle 返回同一多重集的排列，且不修改入参', () => {
  const rng = createRng(9);
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(rng, src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8], '入参不得被修改');
  assert.deepEqual(out.slice().sort((a, b) => a - b), src);
});

test('shuffle 确定性：同 seed 同结果', () => {
  const src = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  assert.deepEqual(shuffle(createRng(5), src), shuffle(createRng(5), src));
});

test('shuffle 的分布不是退化的（首位不总是同一个元素）', () => {
  const src = [0, 1, 2, 3, 4];
  const firsts = new Set();
  for (let s = 0; s < 200; s++) firsts.add(shuffle(createRng(s), src)[0]);
  assert.ok(firsts.size >= 4, `首位取值过于集中：${[...firsts]}`);
});

test('weightedIndex 按权重返回合法下标', () => {
  const rng = createRng(11);
  const w = [1, 0, 3]; // 下标 1 权重为 0，永远不该被选中
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const idx = weightedIndex(rng, w);
    seen.add(idx);
    assert.ok(idx >= 0 && idx < w.length);
  }
  assert.ok(!seen.has(1), '权重为 0 的项不应被选中');
});

test('weightedIndex 权重和必须为正', () => {
  assert.throws(() => weightedIndex(createRng(1), [0, 0]), RangeError);
});
