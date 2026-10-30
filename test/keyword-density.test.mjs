/**
 * text/keyword-density 的能力测试
 * 核心是把原型链污染这条缺陷钉死：只要实现改回 `counts = {}`，这些断言必须转红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeKeywordDensity, DEFAULT_STOP_WORDS } from '../src/text/keyword-density.mjs';

test('基础统计：词数 / 字符数 / 阅读时间（200 词每分钟）', () => {
  const r = analyzeKeywordDensity('one two three four five');
  assert.equal(r.totalWords, 5);
  assert.equal(r.totalCharacters, 23);
  assert.equal(r.readingTimeMinutes, 1);
});

test('[F1] 原型链词不会污染统计：constructor / toString / valueOf', () => {
  const r = analyzeKeywordDensity('constructor constructor constructor toString valueOf');
  for (const k of r.topKeywords) {
    assert.equal(typeof k.count, 'number', `${k.word} 的 count 必须是数字`);
    assert.ok(Number.isFinite(k.count), `${k.word} 的 count 必须是有限数`);
  }
  const c = r.topKeywords.find((k) => k.word === 'constructor');
  assert.ok(c, 'constructor 应作为普通词出现');
  assert.equal(c.count, 3);
});

test('[F1] __proto__ / hasOwnProperty 同样不得污染', () => {
  const r = analyzeKeywordDensity('__proto__ hasOwnProperty __proto__ hasOwnProperty hasOwnProperty');
  for (const k of r.topKeywords) {
    assert.ok(Number.isFinite(k.count));
    assert.ok(!String(k.count).includes('function'), 'count 不得变成函数源码字符串');
  }
  assert.equal(r.topKeywords.find((k) => k.word === 'hasownproperty').count, 3);
});

test('[证据] 站点原实现的 counts = {} 确实会被原型链污染', () => {
  // 复刻站点实现的关键片段，确认缺陷真实存在（取证用，不测新实现）
  const legacy = {};
  for (const w of ['constructor', 'constructor']) legacy[w] = (legacy[w] || 0) + 1;
  assert.ok(
    !Number.isFinite(legacy['constructor']),
    'counts={} 时 constructor 会取到 Object 原型上的函数，计数不再是数字'
  );
});

test('[F2] 中文文本可正常分词（站点实现会整段清空）', () => {
  const r = analyzeKeywordDensity('关键词 密度 分析 关键词 密度 关键词');
  assert.equal(r.totalWords, 6);
  assert.equal(r.topKeywords[0].word, '关键词');
  assert.equal(r.topKeywords[0].count, 3);
});

test('[F2] 非拉丁文本占比过高时给出 warning', () => {
  const r = analyzeKeywordDensity('这是一段中文文本用于测试警告');
  assert.ok(r.warnings.some((w) => w.includes('非拉丁字符')));
});

test('[F3] 空文本阅读时间为 0，而不是 1 分钟', () => {
  const r = analyzeKeywordDensity('');
  assert.equal(r.readingTimeMinutes, 0);
  assert.equal(r.totalWords, 0);
  assert.deepEqual(r.topKeywords, []);
});

test('[F4] 两个密度语义明确：占全部词 / 占实词', () => {
  // 9 个词：the×4（停用词）+ apple×3 + banana + orange = 实词 5 个
  const r = analyzeKeywordDensity('the apple the apple the apple the banana orange');
  assert.equal(r.totalWords, 9);
  const apple = r.topKeywords.find((k) => k.word === 'apple');
  assert.equal(apple.count, 3);
  assert.equal(apple.density, 33.33); // 3/9
  assert.equal(apple.densityOfContentWords, 60); // 3/5（实词：apple×3, banana, orange）
});

test('停用词表已补全高频词（a / is / of / to 不应出现在 Top 关键词里）', () => {
  const r = analyzeKeywordDensity('This is a test of the tool and it is a good test of the tool');
  const words = r.topKeywords.map((k) => k.word);
  for (const sw of ['a', 'is', 'of', 'the', 'and', 'it', 'this']) {
    assert.ok(!words.includes(sw), `${sw} 不应出现在 Top 关键词中`);
  }
  assert.ok(words.includes('test'));
});

test('自定义停用词表可整体替换；传空数组则不去停用词', () => {
  const text = 'alpha beta alpha';
  const noStop = analyzeKeywordDensity(text, { stopWords: [] });
  assert.equal(noStop.contentWordCount, 3);
  const custom = analyzeKeywordDensity(text, { stopWords: ['alpha'] });
  assert.equal(custom.topKeywords[0].word, 'beta');
});

test('focus 关键词：计频、密度与判定阈值（1%–3% 为 optimal）', () => {
  const text = ('alpha '.repeat(2) + 'beta '.repeat(98)).trim(); // 100 词，alpha 占 2%
  const r = analyzeKeywordDensity(text, { focusKeyword: 'ALPHA' });
  assert.equal(r.focus.keyword, 'alpha', 'focus 应大小写不敏感');
  assert.equal(r.focus.count, 2);
  assert.equal(r.focus.density, 2);
  assert.equal(r.focus.verdict, 'optimal');

  const high = analyzeKeywordDensity(('alpha '.repeat(10) + 'beta '.repeat(90)).trim(), { focusKeyword: 'alpha' });
  assert.equal(high.focus.verdict, 'too-high');

  const low = analyzeKeywordDensity(('alpha '.repeat(1) + 'beta '.repeat(199)).trim(), { focusKeyword: 'alpha' });
  assert.equal(low.focus.verdict, 'low');
});

test('focus 命中停用词时明确告知 count 恒为 0', () => {
  const r = analyzeKeywordDensity('the cat and the dog', { focusKeyword: 'the' });
  assert.equal(r.focus.count, 0);
  assert.equal(r.focus.isStopWord, true);
  assert.ok(r.warnings.some((w) => w.includes('停用词')));
});

test('2-gram 短语统计与排序', () => {
  const r = analyzeKeywordDensity('machine learning is great machine learning is fast machine learning rocks');
  const top = r.topPhrases[0];
  assert.equal(top.phrase, 'machine learning');
  assert.equal(top.count, 3);
});

test('topN / phraseN 可配置，且不会越界', () => {
  const text = 'alpha beta gamma delta epsilon';
  const r = analyzeKeywordDensity(text, { topN: 2, phraseN: 1, stopWords: [] });
  assert.equal(r.topKeywords.length, 2);
  assert.ok(r.topPhrases.length <= 1);
});

test('确定性：同一输入两次结果完全一致（含排序稳定性）', () => {
  const t = 'beta alpha beta gamma alpha beta';
  assert.deepEqual(analyzeKeywordDensity(t), analyzeKeywordDensity(t));
});

test('DEFAULT_STOP_WORDS 覆盖了缺失的高频词', () => {
  for (const w of ['a', 'an', 'is', 'it', 'of', 'to', 'in', 'on', 'or', 'as', 'at', 'not']) {
    assert.ok(DEFAULT_STOP_WORDS.has(w), `停用词表应包含 ${w}`);
  }
});

test('零依赖声明：模块只引用内置能力', async () => {
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/text/keyword-density.mjs', import.meta.url), 'utf8')
  );
  const imports = [...src.matchAll(/^\s*import\s.+?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, []);
});
