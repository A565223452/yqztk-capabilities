/**
 * text/readability 的能力测试
 * 关键不是「能跑」，而是：公式可手算复核、被动语态不误报、非拉丁文本不臆造分数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeReadability,
  countSyllables,
  splitSentences,
  describeFleschEase,
} from '../src/text/readability.mjs';

test('音节估算启发式（与原工具一致，含公认的启发式偏差）', () => {
  assert.equal(countSyllables('the'), 1);
  assert.equal(countSyllables('cat'), 1);
  assert.equal(countSyllables('beautiful'), 4); // 启发式给出 4，词典值 3 —— 这是所有 Flesch 实现的共同局限
  assert.equal(countSyllables('university'), 5);
  assert.equal(countSyllables(''), 0);
});

test('golden vector：公式结果可手算复核', () => {
  // "The cat sat on the mat." → 6 词、1 句、6 音节、0 复杂词
  // fre = 206.835 - 1.015*6 - 84.6*1      = 116.145 → 116.1
  // fk  = 0.39*6 + 11.8*1 - 15.59         = -1.45   → -1.4
  // fog = 0.4*(6 + 100*0/6)               = 2.4
  const r = analyzeReadability('The cat sat on the mat.');
  assert.equal(r.status, 'ok');
  assert.equal(r.wordCount, 6);
  assert.equal(r.sentenceCount, 1);
  assert.equal(r.syllableCount, 6);
  assert.equal(r.complexWordCount, 0);
  assert.equal(r.scores.fleschReadingEase, 116.1);
  assert.equal(r.scores.fleschKincaidGrade, -1.4);
  assert.equal(r.scores.gunningFog, 2.4);
});

test('句子越长、词越复杂 → 可读性分数越低（单调性）', () => {
  const easy = analyzeReadability('The cat sat on the mat. The dog ran fast.');
  const hard = analyzeReadability(
    'The extraordinarily complicated methodological framework demonstrates substantial interconnectedness ' +
      'between numerous fundamental parameters that necessitate comprehensive reconsideration.'
  );
  assert.ok(hard.scores.fleschReadingEase < easy.scores.fleschReadingEase);
});

test('[F1] "is not" 不再被误判为被动语态（站点实现的真实缺陷）', () => {
  const r = analyzeReadability('This result is not correct. The value is not available.');
  assert.equal(r.passive.count, 0, '"is not" 不应判为被动');
});

test('[F1] 真正的被动语态仍能被识别', () => {
  const r = analyzeReadability('The report was written by the team. The bug was found yesterday.');
  assert.equal(r.passive.count, 2);
});

test('[F1] 不规则过去分词也能识别（不只靠 ed/en 结尾）', () => {
  const r = analyzeReadability('The decision was made quickly. The letter was sent.');
  assert.equal(r.passive.count, 2);
});

test('[证据] 站点原实现的被动判定正则确实会把 "is not" 判成被动', () => {
  // 复刻站点实现的核心正则，确认缺陷真实存在（本测试是对缺陷的取证，不测新实现）
  const legacy = /\b(is|are|was|were|been|be|being)\b\s+\b\w+(ed|en|t|wn|ne|de)\b/i;
  assert.equal(legacy.test('This is not correct'), true, '旧正则误报为被动');
});

test('[F2] 中文文本不臆造 Flesch 分数，返回 null 并给出 warning', () => {
  const r = analyzeReadability('这是一段完全由中文字符组成的文本，用于验证非拉丁文本的处理路径是否安全。');
  assert.equal(r.status, 'notApplicable');
  assert.equal(r.scores.fleschReadingEase, null);
  assert.equal(r.scores.fleschKincaidGrade, null);
  assert.ok(r.warnings.some((w) => w.includes('拉丁词')));
});

test('[F2] 中英混排时给出占比 warning，但仍按拉丁词计算', () => {
  const r = analyzeReadability('The quick brown fox jumps over the lazy dog. 这是一句中文补充说明。');
  assert.equal(r.status, 'ok');
  assert.ok(r.scores.fleschReadingEase !== null);
  assert.ok(r.warnings.some((w) => w.includes('非拉丁词')));
});

test('[F3] 缩写不触发断句（Mr. / e.g. / U.S.）', () => {
  assert.equal(splitSentences('Mr. Smith went home.').length, 1);
  assert.equal(splitSentences('Use a tool, e.g. a calculator.').length, 1);
  assert.equal(splitSentences('The U.S. market grew.').length, 1);
  assert.equal(splitSentences('He went home. She stayed.').length, 2);
});

test('[F5] 切句不丢片段：缩写之前的文字必须原样保留', () => {
  const s = splitSentences('Use a tool, e.g. a calculator.');
  assert.equal(s.length, 1);
  assert.equal(s[0], 'Use a tool, e.g. a calculator.', '整句必须完整，不得只剩 "g. a calculator."');
  const us = splitSentences('The U.S. market grew fast.');
  assert.equal(us[0], 'The U.S. market grew fast.');
  const pct = splitSentences('Growth was 3.5 percent. That is good.');
  assert.equal(pct.length, 2);
  assert.equal(pct[0], 'Growth was 3.5 percent.');
});

test('[证据] 站点原实现的切句正则确实会丢掉终止符之前的片段', () => {
  const legacy = (t) => {
    const re = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;
    const o = [];
    let m;
    while ((m = re.exec(t)) !== null) o.push(m[0].trim());
    return o.filter(Boolean);
  };
  const got = legacy('Use a tool, e.g. a calculator.');
  assert.ok(!got.join(' ').includes('Use a tool'), '旧实现丢掉了 "Use a tool, " 这一段');
  assert.ok(got[0].startsWith('g.'), '旧实现从 "g." 开始重新匹配');
});

test('[F4] 长句会被单独列出，便于定位问题句', () => {
  const long = 'a '.repeat(35).trim() + '.';
  const r = analyzeReadability(long + ' Short one.');
  assert.equal(r.longSentences.length, 1);
  assert.equal(r.longSentences[0].words, 35);
  assert.ok(r.warnings.some((w) => w.includes('超过 30 词')));
});

test('空值与短文本走 empty 分支，不抛错', () => {
  for (const v of ['', '   ', null, undefined, 'hi']) {
    const r = analyzeReadability(v);
    assert.equal(r.status, 'empty');
    assert.equal(r.scores.fleschReadingEase, null);
  }
});

test('确定性：同一输入两次结果完全一致', () => {
  const t = 'The quick brown fox jumps over the lazy dog. It was found in the garden.';
  assert.deepEqual(analyzeReadability(t), analyzeReadability(t));
});

test('释义函数在分数为 null 时不崩', () => {
  assert.equal(describeFleschEase(null).level, 'unknown');
  assert.equal(describeFleschEase(90).level, 'very-easy');
  assert.equal(describeFleschEase(20).level, 'very-difficult');
});
