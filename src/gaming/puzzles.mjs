/**
 * capability 组：谜题生成与牌组曲线
 * ============================================================
 * 覆盖来源工具：
 *   - gaming-escape-room-puzzle-gen    密室谜题生成
 *   - gaming-mtg-mana-curve            集换式卡牌的法力曲线建议
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] 谜题生成必须可复现：站点全篇用 `Math.random()`，同一难度每次刷新都是
 *        不同题目，老师/组织者无法「出好一套题再打印出来」。本能力要求传 `seed`，
 *        相同 seed + 相同参数必得同一道题与同一个答案。
 *   [F2] 洗牌换成 Fisher–Yates（站点用 `sort(() => Math.random() - 0.5)`）。
 *   [F3] 曲线分配不再依赖浮点余数：站点用「floor 后按小数部分排序补余数」，
 *        在并列小数时结果不稳定。本能力用带稳定 tie-break 的最大余数法。
 *   [F4] 返回题面与答案分离的结构（`puzzle` / `solution`），
 *        而不是把答案和题面混在一段 HTML 里（站点会把答案直接渲染在结果区，
 *        打印发给参与者时需要手动裁剪）。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 谜题强度是「费时程度」的经验分档，不代表密码学或逻辑学上的难度。
 *   [L2] 摩斯码与二进制类谜题对不熟悉编码的参与者门槛较高，需自行判断受众。
 *   [L3] 法力曲线建议基于「地牌占比 40%」的简化模型，未考虑套牌速度、
 *       卡牌选择、颜色修正等地牌以外的因素。
 */

import { createRng, randomInt, pickOne, shuffle } from '../lib/prng.mjs';

const round = (x, n = 2) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

export const PUZZLE_TYPES = Object.freeze([
  'caesar', 'substitution', 'reverse', 'binary', 'morse', 'sequence', 'riddle',
]);

export const PUZZLE_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

const PHRASE_POOL = Object.freeze([
  'THE KEY IS UNDER THE STAIRS',
  'LOOK BEHIND THE PAINTING',
  'FOLLOW THE RED THREAD',
  'TIME IS RUNNING OUT',
  'THE CODE IS IN THE BOOK',
  'OPEN THE BLUE DRAWER',
  'COUNT THE CANDLES',
  'NOTHING IS WHAT IT SEEMS',
  'THE MIRROR SHOWS THE WAY',
  'LISTEN TO THE CLOCK',
]);

const MORSE_TABLE = Object.freeze({
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', ' ': '/',
});

const RIDDLES = Object.freeze([
  { q: 'I have keys but no locks. I have space but no room. You can enter, but never leave. What am I?', a: 'A keyboard' },
  { q: 'The more you take, the more you leave behind. What am I?', a: 'Footsteps' },
  { q: 'I speak without a mouth and hear without ears. I have nobody, but I come alive with wind. What am I?', a: 'An echo' },
  { q: 'What has a head, a tail, but no body?', a: 'A coin' },
  { q: 'I am not alive, but I grow. I have no lungs, but I need air. What am I?', a: 'Fire' },
]);

const CAESAR_SHIFT = Object.freeze({ easy: 3, medium: 5, hard: 8 });
const SEQUENCE_STEP = Object.freeze({ easy: 2, medium: 3, hard: 5 });

function caesar(text, shift) {
  const s = (((shift % 26) + 26) % 26);
  return text.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + s) % 26) + base);
  });
}

function toMorse(text) {
  return text
    .toUpperCase()
    .split('')
    .map((c) => MORSE_TABLE[c] ?? c)
    .join(' ');
}

/**
 * 生成一道密室谜题。
 *
 * @param {object} input
 * @param {'caesar'|'substitution'|'reverse'|'binary'|'morse'|'sequence'|'riddle'} [input.type]
 * @param {'easy'|'medium'|'hard'} [input.difficulty='medium']
 * @param {number|string} [input.seed=1] **必需**才能复现（[F1]）
 * @param {string} [input.phrase] 自定义明文（可选）
 */
export function generateEscapeRoomPuzzle(input = {}) {
  const seed = input.seed === undefined ? 1 : input.seed;
  const difficulty = input.difficulty ?? 'medium';
  if (!PUZZLE_DIFFICULTIES.includes(difficulty)) {
    throw new RangeError(`difficulty 只能是 ${PUZZLE_DIFFICULTIES.join(' / ')}`);
  }

  const rng = createRng(seed);
  const type = input.type ?? pickOne(rng, PUZZLE_TYPES);
  if (!PUZZLE_TYPES.includes(type)) throw new RangeError(`type 只能是 ${PUZZLE_TYPES.join(' / ')}`);

  const phrase = String(input.phrase ?? pickOne(rng, PHRASE_POOL)).toUpperCase();

  const base = { type, difficulty, seed, phrase, generatedBy: 'deterministic-prng' };

  switch (type) {
    case 'caesar': {
      const shift = CAESAR_SHIFT[difficulty];
      return {
        ...base,
        puzzle: caesar(phrase, shift),
        solution: phrase,
        hint: `每个字母向后移动 ${shift} 位（凯撒位移）`,
        instructions: '把每个字母在字母表中前移固定位数，还原出原文。',
      };
    }
    case 'substitution': {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const key = shuffle(rng, alphabet);
      const map = Object.fromEntries(alphabet.map((c, i) => [c, key[i]]));
      return {
        ...base,
        puzzle: phrase.replace(/[A-Z]/g, (c) => map[c]),
        solution: phrase,
        keyTable: map,
        hint: '这是一个字母替换表，把乱码按对照表还原',
        instructions: '拿到替换对照表后逐字还原；不提供对照表时属于高难度谜题。',
        scrambleKey: key.join(''),
      };
    }
    case 'reverse': {
      return {
        ...base,
        puzzle: phrase.split('').reverse().join(''),
        solution: phrase,
        hint: '把整串字符倒过来读',
        instructions: '从最后一个字符往前读。',
      };
    }
    case 'binary': {
      return {
        ...base,
        puzzle: phrase
          .split('')
          .map((c) => c.charCodeAt(0).toString(2).padStart(8, '0'))
          .join(' '),
        solution: phrase,
        hint: '每 8 位二进制数对应一个 ASCII 字符',
        instructions: '把每 8 位二进制转成十进制，再查 ASCII 表。',
      };
    }
    case 'morse': {
      return {
        ...base,
        puzzle: toMorse(phrase),
        solution: phrase,
        morseTable: MORSE_TABLE,
        hint: '点划组合对应字母，斜杠代表空格',
        instructions: '用摩斯码表逐组翻译，斜杠分隔单词。',
      };
    }
    case 'sequence': {
      const step = SEQUENCE_STEP[difficulty];
      const start = randomInt(rng, 1, 50);
      const terms = [];
      for (let i = 0; i < 6; i++) terms.push(start + i * step);
      const next = terms[terms.length - 1] + step;
      return {
        ...base,
        puzzle: `${terms.join(', ')}, ?`,
        solution: String(next),
        hint: `相邻两项的差是常数`,
        instructions: '找出数列规律并写出下一项。',
        sequence: terms,
      };
    }
    case 'riddle': {
      const r = pickOne(rng, RIDDLES);
      return {
        ...base,
        puzzle: r.q,
        solution: r.a,
        hint: '这是一道文字谜语，答案是常见物品或现象',
        instructions: '朗读题目并思考字面与引申含义。',
      };
    }
    default:
      throw new RangeError(`未知谜题类型：${type}`);
  }
}

/**
 * 法力曲线与地牌数量建议。
 *
 * @param {object} input
 * @param {number} [input.deckSize=60] 套牌张数
 * @param {number} [input.colors=2] 颜色数
 * @param {number} [input.rampCount=4] 加速牌数量
 * @param {number} [input.targetAverageCmc=2.5] 目标平均费用
 * @param {number[]} [input.curve] 手动指定的 0..6 费用分布（长度 7）
 */
export function analyzeManaCurve(input = {}) {
  const deckSize = Number(input.deckSize ?? 60);
  const colors = Number(input.colors ?? 2);
  const ramp = Number(input.rampCount ?? 4);
  const targetAvg = Number(input.targetAverageCmc ?? 2.5);

  if (!Number.isInteger(deckSize) || deckSize < 40 || deckSize > 250) throw new RangeError('deckSize 必须是 40~250 的整数');
  if (!Number.isInteger(colors) || colors < 1 || colors > 5) throw new RangeError('colors 必须是 1~5 的整数');
  if (!Number.isInteger(ramp) || ramp < 0 || ramp > 30) throw new RangeError('rampCount 必须是 0~30 的整数');
  if (!Number.isFinite(targetAvg) || targetAvg < 0 || targetAvg > 7) throw new RangeError('targetAverageCmc 必须在 0~7 之间');

  // 地牌基准：单色 20 / 双色 22 …（沿站点口径 18 + 2×颜色数，并按 60 张比例缩放）
  const landCount = Math.round(((18 + colors * 2) * deckSize) / 60);
  const nonLand = Math.max(0, deckSize - landCount);

  let curve;
  let generationMethod;
  if (Array.isArray(input.curve)) {
    if (input.curve.length !== 7) throw new RangeError('curve 必须是长度为 7 的数组（费用 0..6）');
    curve = input.curve.map((x) => {
      const n = Number(x);
      if (!Number.isInteger(n) || n < 0) throw new RangeError('curve 的元素必须是非负整数');
      return n;
    });
    generationMethod = 'provided';
  } else {
    // 以 targetAvg 为中心的正态权重，再用最大余数法取整（[F3] 稳定 tie-break）
    const weights = [];
    let sum = 0;
    for (let i = 0; i <= 6; i++) {
      const w = Math.exp(-0.5 * (i - targetAvg) ** 2);
      weights.push(w);
      sum += w;
    }
    const exact = weights.map((w) => (sum > 0 ? (nonLand * w) / sum : 0));
    curve = exact.map((x) => Math.floor(x));
    let used = curve.reduce((a, b) => a + b, 0);
    const remainder = nonLand - used;
    const order = exact
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < remainder; k++) curve[order[k % order.length].i] += 1;
    generationMethod = 'derived-from-target-average';
  }

  const totalNonLand = curve.reduce((a, b) => a + b, 0);
  const weightedSum = curve.reduce((a, c, i) => a + c * i, 0);
  const actualAvg = totalNonLand > 0 ? weightedSum / totalNonLand : 0;
  const landRecommendation = Math.max(0, landCount - Math.round(ramp / 2));

  const advice = [];
  if (actualAvg < targetAvg - 0.5) advice.push('曲线偏低：可以增加高费威胁或减少低费填充');
  else if (actualAvg > targetAvg + 0.5) advice.push('曲线偏高：增加低费生物或法力加速');
  else advice.push('曲线与目标接近，分布合理');
  if (ramp >= 8) advice.push(`加速牌 ${ramp} 张偏多，注意避免起手全是加速而没有威胁`);

  const warnings = ['法力建议基于「地牌约占 40%」的简化模型，未考虑套牌速度与颜色修正'];
  if (landCount + totalNonLand !== deckSize) {
    warnings.push(`地牌 ${landCount} + 非地牌 ${totalNonLand} 与套牌总数 ${deckSize} 不一致，请检查曲线输入`);
  }

  return {
    deck: { deckSize, colors, rampCount: ramp, targetAverageCmc: targetAvg },
    lands: { count: landCount, recommendedWithRamp: landRecommendation, nonLandCards: totalNonLand },
    curve: { distribution: curve, generationMethod, total: totalNonLand },
    actual: { averageCmc: round(actualAvg, 2), deltaFromTarget: round(actualAvg - targetAvg, 2) },
    advice,
    warnings,
  };
}
