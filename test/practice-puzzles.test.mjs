/**
 * religion/practice 与 gaming/puzzles 测试
 * 重点是 [F1]/[F3]：调度与生成都必须可复现，且不再读写系统时钟。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleScriptureReview,
  getDueVerses,
  promoteVerse,
  REVIEW_INTERVALS_DAYS,
  LEVELS,
} from '../src/religion/practice.mjs';
import { generateEscapeRoomPuzzle, analyzeManaCurve, PUZZLE_TYPES } from '../src/gaming/puzzles.mjs';

const DAY = 86400000;

test('[F1] 调度必须显式传入 now（不再读系统时钟）', () => {
  assert.throws(() => scheduleScriptureReview({ verses: [] }), /now/);
  assert.throws(() => scheduleScriptureReview({ verses: [], now: 'not-a-date' }), /now/);
});

test('调度：只选出到期的条目', () => {
  const verses = [
    { ref: 'A', level: 'new', nextReview: 0 },
    { ref: 'B', level: 'weekly', nextReview: 5 * DAY },
    { ref: 'C', level: 'new', nextReview: 10 * DAY },
  ];
  const r = scheduleScriptureReview({ verses, now: 1 * DAY });
  assert.equal(r.dueCount, 1, '只有 A 在 1 天时已到期');
  assert.deepEqual(r.due.map((d) => d.ref), ['A']);

  const later = scheduleScriptureReview({ verses, now: 6 * DAY });
  assert.equal(later.dueCount, 2);
  assert.deepEqual(later.due.map((d) => d.ref), ['A', 'B']);
});

test('调度：不传 seed 时选最早到期（确定性策略）', () => {
  const verses = [
    { ref: 'later', nextReview: 3 * DAY },
    { ref: 'earliest', nextReview: 1 * DAY },
  ];
  const r = scheduleScriptureReview({ verses, now: 5 * DAY });
  assert.equal(r.selectionStrategy, 'earliest-due');
  assert.equal(r.selected.ref, 'earliest');
});

test('[F2] 传 seed 时可在到期项中伪随机挑选，且结果可复现', () => {
  const verses = ['a', 'b', 'c', 'd'].map((ref, i) => ({ ref, nextReview: i * DAY }));
  const a = scheduleScriptureReview({ verses, now: 10 * DAY, seed: 3 });
  const b = scheduleScriptureReview({ verses, now: 10 * DAY, seed: 3 });
  assert.equal(a.selectionStrategy, 'seeded-random');
  assert.equal(a.selected.ref, b.selected.ref);
});

test('调度：没有到期项时给出下次到期时间', () => {
  const verses = [{ ref: 'A', nextReview: 10 * DAY }];
  const r = scheduleScriptureReview({ verses, now: 1 * DAY });
  assert.equal(r.dueCount, 0);
  assert.equal(r.selected, null);
  assert.equal(r.nextDueRef, 'A');
});

test('等级推进：按固定间隔表前进', () => {
  const v = { ref: 'A', level: 'new', nextReview: 0 };
  const p1 = promoteVerse(v, 0);
  assert.equal(p1.level, '3day');
  assert.equal(p1.nextReview, 3 * DAY);
  const p2 = promoteVerse(p1, 0);
  assert.equal(p2.level, 'weekly');
  assert.equal(p2.nextReview, 7 * DAY);
});

test('[F3] 已满级时标记 graduated 而不是静默停住', () => {
  const v = { ref: 'A', level: 'mastered', nextReview: 0 };
  const p = promoteVerse(v, 0);
  assert.equal(p.level, 'mastered');
  assert.equal(p.graduated, true);
  assert.equal(p.intervalDays, REVIEW_INTERVALS_DAYS.mastered);
});

test('autoPromote 会同时给出升级结果与满级告警', () => {
  const r = scheduleScriptureReview({
    verses: [{ ref: 'A', level: 'mastered', nextReview: 0 }],
    now: 0,
    autoPromote: true,
  });
  assert.equal(r.promoted.graduated, true);
  assert.ok(r.warnings.some((w) => w.includes('最高等级')));
});

test('getDueVerses 按到期时间升序', () => {
  const verses = [
    { ref: 'c', nextReview: 5 * DAY },
    { ref: 'a', nextReview: 1 * DAY },
    { ref: 'b', nextReview: 3 * DAY },
  ];
  assert.deepEqual(getDueVerses(verses, 10 * DAY).map((v) => v.ref), ['a', 'b', 'c']);
});

test('条目字段缺失时用安全默认值', () => {
  const v = promoteVerse({ ref: 'X', text: 'y' }, 0);
  assert.equal(v.translation, '');
  assert.equal(v.intervalDays, REVIEW_INTERVALS_DAYS['3day']);
});

test('等级表顺序固定', () => {
  assert.deepEqual(LEVELS, ['new', '3day', 'weekly', 'biweekly', 'mastered']);
});

test('[F1] 谜题生成可复现：同 seed 同题目同答案', () => {
  for (const type of PUZZLE_TYPES) {
    const a = generateEscapeRoomPuzzle({ type, difficulty: 'medium', seed: 123 });
    const b = generateEscapeRoomPuzzle({ type, difficulty: 'medium', seed: 123 });
    assert.equal(a.puzzle, b.puzzle, `${type} 题目不可复现`);
    assert.equal(a.solution, b.solution, `${type} 答案不可复现`);
  }
});

test('[F1] 不同 seed 得到不同题目', () => {
  const a = generateEscapeRoomPuzzle({ type: 'caesar', seed: 1 });
  const b = generateEscapeRoomPuzzle({ type: 'caesar', seed: 2 });
  assert.notEqual(a.puzzle, b.puzzle);
});

test('凯撒谜题：位移量按难度变化，且能还原', () => {
  const easy = generateEscapeRoomPuzzle({ type: 'caesar', difficulty: 'easy', seed: 1, phrase: 'ABC' });
  assert.equal(easy.puzzle, 'DEF');
  assert.equal(easy.solution, 'ABC');
  const hard = generateEscapeRoomPuzzle({ type: 'caesar', difficulty: 'hard', seed: 1, phrase: 'ABC' });
  assert.notEqual(hard.puzzle, 'DEF');
});

test('各类谜题的题面与答案都不为空，且题面不等于答案', () => {
  for (const type of PUZZLE_TYPES) {
    const r = generateEscapeRoomPuzzle({ type, seed: 7 });
    assert.ok(r.puzzle.length > 0, `${type} 题面为空`);
    assert.ok(r.solution.length > 0, `${type} 答案为空`);
    if (type !== 'riddle') assert.notEqual(r.puzzle, r.solution, `${type} 题面与答案相同`);
    assert.ok(r.hint.length > 0);
  }
});

test('反向谜题：答案反转等于题面', () => {
  const r = generateEscapeRoomPuzzle({ type: 'reverse', seed: 1, phrase: 'HELLO' });
  assert.equal(r.puzzle, 'OLLEH');
});

test('二进制谜题：8 位分组，数量等于字符数', () => {
  const r = generateEscapeRoomPuzzle({ type: 'binary', seed: 1, phrase: 'AB' });
  const groups = r.puzzle.split(' ');
  assert.equal(groups.length, 2);
  for (const g of groups) assert.match(g, /^[01]{8}$/);
});

test('摩斯谜题：含点划与分隔符', () => {
  const r = generateEscapeRoomPuzzle({ type: 'morse', seed: 1, phrase: 'AB C' });
  assert.match(r.puzzle, /[.-]/);
  assert.ok(r.morseTable);
});

test('数列谜题：答案是下一项', () => {
  const r = generateEscapeRoomPuzzle({ type: 'sequence', difficulty: 'medium', seed: 4 });
  assert.equal(r.sequence.length, 6);
  const step = r.sequence[1] - r.sequence[0];
  assert.equal(r.sequence[5] - r.sequence[0], step * 5, '应为等差数列');
  assert.equal(Number(r.solution), r.sequence[5] + step, '答案必须是下一项');
  assert.equal(r.puzzle, `${r.sequence.join(', ')}, ?`);
});

test('谜题：非法输入抛错', () => {
  assert.throws(() => generateEscapeRoomPuzzle({ type: 'nope' }), RangeError);
  assert.throws(() => generateEscapeRoomPuzzle({ difficulty: 'nightmare' }), RangeError);
});

test('法力曲线：60 张双色 → 22 张地牌', () => {
  const r = analyzeManaCurve({ deckSize: 60, colors: 2, rampCount: 4 });
  assert.equal(r.lands.count, 22);
  assert.equal(r.lands.nonLandCards, 38);
});

test('法力曲线：自动分配之和等于非地牌数', () => {
  const r = analyzeManaCurve({ deckSize: 60, colors: 2, rampCount: 4, targetAverageCmc: 3 });
  assert.equal(r.curve.distribution.reduce((a, b) => a + b, 0), 38);
  assert.equal(r.curve.generationMethod, 'derived-from-target-average');
  assert.equal(r.curve.distribution.length, 7);
});

test('法力曲线：可传入自定义曲线', () => {
  const curve = [0, 12, 10, 8, 5, 2, 1];
  const r = analyzeManaCurve({ deckSize: 60, colors: 2, rampCount: 4, curve });
  assert.deepEqual(r.curve.distribution, curve);
  assert.equal(r.curve.generationMethod, 'provided');
  assert.equal(r.curve.total, 38);
});

test('法力曲线：实际平均费用与目标差异过大时给出建议', () => {
  const low = analyzeManaCurve({ deckSize: 60, colors: 1, rampCount: 0, targetAverageCmc: 5, curve: [0, 20, 5, 0, 0, 0, 0] });
  assert.ok(low.actual.averageCmc < 5);
  assert.ok(low.advice.length > 0);
});

test('法力曲线：地牌 + 非地牌不等于套牌数时告警', () => {
  const r = analyzeManaCurve({ deckSize: 60, colors: 2, rampCount: 4, curve: [0, 1, 1, 1, 1, 1, 1] });
  assert.ok(r.warnings.some((w) => w.includes('不一致')));
});

test('法力曲线：加速牌过多时提示', () => {
  const r = analyzeManaCurve({ deckSize: 60, colors: 2, rampCount: 10 });
  assert.ok(r.advice.some((a) => a.includes('加速牌')));
});

test('法力曲线：非法输入抛错', () => {
  assert.throws(() => analyzeManaCurve({ deckSize: 10 }), RangeError);
  assert.throws(() => analyzeManaCurve({ deckSize: 60, colors: 9 }), RangeError);
  assert.throws(() => analyzeManaCurve({ deckSize: 60, curve: [1, 2, 3] }), RangeError);
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(
    generateEscapeRoomPuzzle({ type: 'morse', seed: 31 }),
    generateEscapeRoomPuzzle({ type: 'morse', seed: 31 })
  );
  assert.deepEqual(analyzeManaCurve({ deckSize: 99, colors: 3, rampCount: 6 }), analyzeManaCurve({ deckSize: 99, colors: 3, rampCount: 6 }));
});
