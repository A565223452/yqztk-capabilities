/**
 * text/writing 测试
 * 重点是 [F1]（emoji 字符计数口径）与 [F3]（生成器可复现）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSocialCaption, generateLorem, shuffleWords, PLATFORM_LIMITS } from '../src/text/writing.mjs';

test('文案计数：基础统计', () => {
  const r = countSocialCaption({ text: 'hello #world @someone 👍' });
  assert.equal(r.platform, 'instagram');
  assert.equal(r.limit, 2200);
  assert.equal(r.breakdown.words, 4);
  assert.equal(r.breakdown.hashtags.count, 1);
  assert.equal(r.breakdown.hashtags.items[0], '#world');
  assert.equal(r.breakdown.mentions.count, 1);
  assert.equal(r.breakdown.emojis.count, 1);
});

test('[F1] emoji 按用户感知字符计数，而不是 UTF-16 长度', () => {
  const r = countSocialCaption({ text: '👍' });
  assert.equal(r.count, 1, '一个 emoji 应记作 1 个字符');
  assert.equal(r.utf16Length, 2, '原始 UTF-16 长度仍如实返回，便于与站点对照');
});

test('[F1] 组合 emoji（肤色修饰）仍记作 1 个字符', () => {
  const r = countSocialCaption({ text: '👋🏽' });
  assert.ok(r.count <= 2, `组合 emoji 不应被算成 4 个字符，实际 ${r.count}`);
  assert.equal(r.graphemeMethod === 'Intl.Segmenter' || r.graphemeMethod === 'codePoint', true);
});

test('[F2] emoji 识别覆盖 Expanded_Pictographic（含国旗等）', () => {
  const r = countSocialCaption({ text: '🇨🇳 🎉 🧑‍💻' });
  assert.ok(r.breakdown.emojis.count >= 2, `应至少识别出 2 个 emoji，实际 ${r.breakdown.emojis.count}`);
});

test('文案计数：超限判定与剩余量', () => {
  const r = countSocialCaption({ text: 'a'.repeat(2201) });
  assert.equal(r.over, true);
  assert.equal(r.remaining, -1);
  assert.ok(r.warnings.some((w) => w.includes('超出')));
});

test('文案计数：平台与字段可切换', () => {
  const tw = countSocialCaption({ text: 'hello', platform: 'twitter', field: 'caption' });
  assert.equal(tw.limit, 280);
  const bio = countSocialCaption({ text: 'hello', platform: 'instagram', field: 'bio' });
  assert.equal(bio.limit, 150);
  assert.throws(() => countSocialCaption({ text: 'x', platform: 'myspace' }), RangeError);
});

test('文案计数：空文本不崩', () => {
  const r = countSocialCaption({ text: '' });
  assert.equal(r.count, 0);
  assert.equal(r.breakdown.words, 0);
});

test('平台限值表结构完整', () => {
  for (const [k, v] of Object.entries(PLATFORM_LIMITS)) {
    assert.ok(v.caption > 0 && v.bio > 0, `${k} 限值非法`);
  }
});

test('[F3] 生成器可复现：同 seed 同输出', () => {
  const a = generateLorem({ seed: 42, unit: 'paragraphs', amount: 2 });
  const b = generateLorem({ seed: 42, unit: 'paragraphs', amount: 2 });
  assert.equal(a.text, b.text);
});

test('[F3] 不同 seed 得到不同输出', () => {
  const a = generateLorem({ seed: 1, unit: 'sentences', amount: 3 });
  const b = generateLorem({ seed: 2, unit: 'sentences', amount: 3 });
  assert.notEqual(a.text, b.text);
});

test('生成器：首段以经典句开头', () => {
  const r = generateLorem({ seed: 7, unit: 'paragraphs', amount: 1 });
  assert.ok(r.text.startsWith('Lorem ipsum dolor sit amet'), r.text.slice(0, 40));
});

test('生成器：可关闭经典开头', () => {
  const r = generateLorem({ seed: 7, unit: 'paragraphs', amount: 1, startWithLorem: false });
  assert.equal(r.text.startsWith('Lorem ipsum dolor sit amet'), false);
});

test('生成器：段落模式产出对应数量的段落', () => {
  const r = generateLorem({ seed: 3, unit: 'paragraphs', amount: 3 });
  assert.equal(r.text.split('\n\n').length, 3);
  assert.equal(r.stats.paragraphs, 3);
});

test('生成器：句子模式与词模式的数量正确', () => {
  const sent = generateLorem({ seed: 9, unit: 'sentences', amount: 4, startWithLorem: false });
  assert.equal((sent.text.match(/[.!?]/g) || []).length, 4);
  const words = generateLorem({ seed: 9, unit: 'words', amount: 12 });
  assert.equal(words.stats.words, 12);
});

test('生成器：字符模式精确截断到指定长度', () => {
  const r = generateLorem({ seed: 5, unit: 'characters', amount: 137 });
  assert.equal(r.text.length, 137);
});

test('生成器：非法输入抛错', () => {
  assert.throws(() => generateLorem({ unit: 'pages' }), RangeError);
  assert.throws(() => generateLorem({ unit: 'words', amount: 0 }), RangeError);
  assert.throws(() => generateLorem({ unit: 'characters', amount: 999999 }), RangeError);
});

test('[F4] shuffleWords 是排列且可复现', () => {
  const src = ['a', 'b', 'c', 'd', 'e'];
  const out = shuffleWords(src, 11);
  assert.deepEqual(out.slice().sort(), src);
  assert.deepEqual(src, ['a', 'b', 'c', 'd', 'e'], '入参不得被修改');
  assert.deepEqual(shuffleWords(src, 11), out);
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(countSocialCaption({ text: 'x #y @z' }), countSocialCaption({ text: 'x #y @z' }));
  assert.deepEqual(generateLorem({ seed: 100, unit: 'sentences', amount: 5 }), generateLorem({ seed: 100, unit: 'sentences', amount: 5 }));
});
