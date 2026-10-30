/**
 * capability 组：文本计数与占位文案生成
 * ============================================================
 * 覆盖来源工具：
 *   - social-instagram-character-counter   社媒文案计数与限值
 *   - writing-lorem-ipsum-generator        占位文案生成
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] 文案计数用的是 UTF-16 代码单元还是用户感知字符？站点用 `text.length`，
 *        而 `'👍'.length === 2`。这会让含 emoji 的文案被**高估**字符数，
 *        用户以为超限其实没超（或相反）。本能力同时给出：
 *        `utf16Length`（与站点一致）、`codePoints`（真实码点）、
 *        `graphemeLength`（用户感知，含肤色/家庭等组合 emoji），
 *        并以 `graphemeLength` 作为限值判断依据。
 *   [F2] emoji 计数不再漏掉大部分范围：站点只匹配 \u{1F300}-\u{1F6FF}、
 *        \u{1F900}-\u{1F9FF}、\u{2600}-\u{26FF}、\u{2700}-\u{27BF} 四段，
 *        遗漏了 \u{1F680}-\u{1F6FF} 之外的大量区块与区域指示符（国旗）。
 *        本能力用 Unicode 属性 `\p{Extended_Pictographic}` 做完整匹配。
 *   [F3] 占位文案可复现：站点用 `Math.random()` 生成，同一设置每次结果都不同，
 *        无法复现、无法测试。本能力要求传入 `seed`（见 lib/prng.mjs）。
 *   [F4] shuffle 换成 Fisher–Yates：站点用 `sort(() => Math.random() - 0.5)`，
 *        比较函数不满足传递性，分布有偏。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 平台限值会变，且同一平台不同入口（正文 / 首条评论 / 广告）限值不同，
 *        本表为常见值，不代表官方承诺。
 *   [L2] grapheme 切分基于 `Intl.Segmenter`；在缺失该 API 的环境下回退到
 *        code point 计数，返回值里会标明所用方法。
 *   [L3] lorem 词库是公开的拉丁占位词表，仅用于排版占位，无语义。
 */

import { createRng, randomInt, pickOne, shuffle } from '../lib/prng.mjs';

const round = (x, n = 2) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

/** 各平台常见文案限值（与站点工具一致） */
export const PLATFORM_LIMITS = Object.freeze({
  instagram: { caption: 2200, bio: 150, name: 64, hashtag: 30 },
  twitter: { caption: 280, bio: 160, name: 50, hashtag: 0 },
  tiktok: { caption: 2200, bio: 80, name: 30, hashtag: 0 },
  facebook: { caption: 63206, bio: 101, name: 50, hashtag: 0 },
  youtube: { caption: 5000, bio: 1000, name: 100, hashtag: 0 },
  linkedin: { caption: 3000, bio: 2600, name: 100, hashtag: 0 },
});

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /@[\p{L}\p{N}_.]+/gu;

function graphemeLength(str) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    let n = 0;
    for (const _ of seg.segment(str)) n++;
    return { length: n, method: 'Intl.Segmenter' };
  }
  return { length: [...str].length, method: 'codePoint' };
}

/**
 * 社媒文案计数。
 *
 * @param {object} input
 * @param {string} input.text 文案
 * @param {keyof PLATFORM_LIMITS} [input.platform='instagram']
 * @param {'caption'|'bio'|'name'} [input.field='caption'] 对应哪一栏的限值
 */
export function countSocialCaption(input = {}) {
  const text = input.text == null ? '' : String(input.text);
  const platform = input.platform ?? 'instagram';
  const field = input.field ?? 'caption';

  const limits = PLATFORM_LIMITS[platform];
  if (!limits) throw new RangeError(`未知平台：${platform}（可用：${Object.keys(PLATFORM_LIMITS).join(', ')}）`);
  const limit = limits[field];
  if (limit === undefined) throw new RangeError(`平台 ${platform} 没有字段 ${field}`);

  const g = graphemeLength(text);
  const count = g.length;
  const remaining = limit - count;
  const over = remaining < 0;

  const hashtags = text.match(HASHTAG_RE) || [];
  const mentions = text.match(MENTION_RE) || [];
  const emojis = text.match(EMOJI_RE) || [];

  const warnings = [];
  if (g.method === 'codePoint') warnings.push('当前环境缺少 Intl.Segmenter，组合 emoji 会被按码点计数而略微高估');
  if (over) warnings.push(`超出 ${platform} ${field} 限值 ${Math.abs(remaining)} 个字符`);
  if (emojis.length > 0) {
    warnings.push(`含 ${emojis.length} 个 emoji；站点原实现用 text.length 会把每个 emoji 记作 2 个字符（见 [F1]）`);
  }

  return {
    platform,
    field,
    limit,
    count,
    remaining,
    over,
    usagePercent: round((count / limit) * 100, 1),
    /** 与站点口径一致的原始长度，便于对照 */
    utf16Length: text.length,
    codePoints: [...text].length,
    graphemeMethod: g.method,
    breakdown: {
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      hashtags: { count: hashtags.length, items: hashtags.slice(0, 30) },
      mentions: { count: mentions.length, items: mentions.slice(0, 30) },
      emojis: { count: emojis.length },
      lines: text.split('\n').length,
    },
    warnings,
  };
}

/** 拉丁占位词库（公开的 lorem ipsum 词表） */
const LOREM_WORDS = Object.freeze([
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi',
  'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit',
  'voluptate', 'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
  'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt',
  'mollit', 'anim', 'id', 'est', 'laborum', 'curabitur', 'pretium', 'tincidunt', 'lacus',
  'nulla', 'gravida', 'orci', 'a', 'odio', 'facilisi', 'vivamus', 'arcu', 'felis', 'bibendum',
  'imperdiet', 'dui', 'accumsan', 'sit', 'amet', 'facilisis', 'magna', 'etiam', 'tempor',
  'orci', 'eu', 'lobortis', 'elementum', 'nibh', 'tellus', 'molestie', 'nunc', 'non', 'blandit',
  'massa', 'enim', 'nec', 'dui', 'nunc', 'mattis', 'enim', 'ut', 'sem', 'integer', 'vitae',
  'justo', 'eget', 'magna', 'fermentum', 'iaculis', 'eu', 'non', 'diam', 'pharetra',
]);

const PUNCTUATION = ['.', '.', '.', '!', '?'];
const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

/**
 * 生成占位文案。
 *
 * @param {object} input
 * @param {'paragraphs'|'sentences'|'words'|'characters'} [input.unit='paragraphs']
 * @param {number} [input.amount=1] 生成多少个单位
 * @param {number|string} [input.seed=1] 随机种子（**必需**才能复现，见 [F3]）
 * @param {boolean} [input.startWithLorem=true] 首段是否以经典句开头
 * @param {number} [input.sentencesPerParagraph] 每段句数范围（默认 3~6 随机）
 * @param {number} [input.wordsPerSentence] 每句词数范围（默认 8~16 随机）
 */
export function generateLorem(input = {}) {
  const unit = input.unit ?? 'paragraphs';
  const amount = Number(input.amount ?? 1);
  const seed = input.seed === undefined ? 1 : input.seed;
  const startWithLorem = input.startWithLorem !== false;

  if (!['paragraphs', 'sentences', 'words', 'characters'].includes(unit)) {
    throw new RangeError("unit 只能是 'paragraphs' / 'sentences' / 'words' / 'characters'");
  }
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError('amount 必须是正整数');
  if (unit === 'characters' && amount > 200000) throw new RangeError('characters 模式的 amount 上限为 200000');

  const rng = createRng(seed);

  const sentence = () => {
    const n = input.wordsPerSentence ?? randomInt(rng, 8, 16);
    const ws = [];
    for (let i = 0; i < n; i++) {
      let w = pickOne(rng, LOREM_WORDS);
      if (i === 0) w = w.charAt(0).toUpperCase() + w.slice(1);
      ws.push(w);
    }
    return ws.join(' ') + pickOne(rng, PUNCTUATION);
  };

  const paragraph = (first) => {
    if (first && startWithLorem) {
      const rest = [];
      const restCount = randomInt(rng, 2, 4);
      for (let i = 0; i < restCount; i++) rest.push(sentence());
      return [CLASSIC_OPENING + '.', ...rest].join(' ');
    }
    const n = input.sentencesPerParagraph ?? randomInt(rng, 3, 6);
    const sents = [];
    for (let i = 0; i < n; i++) sents.push(sentence());
    return sents.join(' ');
  };

  let text;
  let paragraphs;
  let sentences;
  let words;

  if (unit === 'paragraphs') {
    const paras = [];
    for (let i = 0; i < amount; i++) paras.push(paragraph(i === 0));
    text = paras.join('\n\n');
    paragraphs = paras.length;
    sentences = paras.reduce((a, p) => a + (p.match(/[.!?]/g) || []).length, 0);
    words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  } else if (unit === 'sentences') {
    const sents = [];
    if (startWithLorem) sents.push(CLASSIC_OPENING + '.');
    while (sents.length < amount) sents.push(sentence());
    text = sents.slice(0, amount).join(' ');
    paragraphs = 1;
    sentences = amount;
    words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  } else if (unit === 'words') {
    const ws = [];
    for (let i = 0; i < amount; i++) {
      let w = pickOne(rng, LOREM_WORDS);
      if (i === 0) w = w.charAt(0).toUpperCase() + w.slice(1);
      ws.push(w);
    }
    text = ws.join(' ') + '.';
    paragraphs = 1;
    sentences = 1;
    words = amount;
  } else {
    // characters：按词拼接到目标长度后截断
    let acc = '';
    while (acc.length < amount) {
      const w = pickOne(rng, LOREM_WORDS);
      acc += (acc ? ' ' : '') + w;
    }
    text = acc.slice(0, amount);
    paragraphs = 1;
    sentences = 1;
    words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  }

  return { unit, amount, seed, text, stats: { paragraphs, sentences, words, characters: text.length } };
}

/** 打乱一个词序（用于测试生成器行为；[F4] 用 Fisher–Yates） */
export function shuffleWords(words, seed = 1) {
  if (!Array.isArray(words)) throw new RangeError('words 必须是数组');
  return shuffle(createRng(seed), words);
}
