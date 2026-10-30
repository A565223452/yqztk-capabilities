/**
 * capability: text/readability
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/ai-detection-readability-score
 * 版本：1.0.0
 *
 * 为什么这个能力值得做：
 *   内容团队（编辑、SEO、本地化）需要的是**可复现的评分**去对比改稿前后，
 *   而 AI 每次给的分数都不一样 —— 不是因为它更聪明，是因为它没有确定性的算法。
 *   本能力给出确定公式 + 逐句问题清单，可以直接进 CI 做门禁。
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 被动语态误报：站点实现用 `\b\w+(ed|en|t|wn|ne|de)\b` 判定过去分词，
 *        于是 "is **not**" 会因为 not 以 t 结尾而被判成被动句。
 *        本实现要求 ed/en 结尾或命中不规则分词表，杜绝这类误报。
 *   [F2] 非拉丁文本：站点实现 `replace(/[^a-z]/g,'')` 把中文/带重音字符清空，
 *        导致音节数为 0、Flesch 分数被拉到极端值且无任何提示。
 *        本实现区分「可计音节词」与「非拉丁词」，并在 warnings 里明确报告
 *        「音节类分数对本段文本不适用」，而不是给出一个看似有效的错数字。
 *   [F3] 缩写切句：站点实现会把 "Mr. Smith" / "e.g." 切成两句，虚增句数。
 *        本实现加入常见缩写保护。
 *   [F4] 返回结构化对象 + 逐句清单，而不是拼好的 HTML。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   音节估算启发式、复杂词定义、以及三条公式（Flesch Reading Ease、
 *   Flesch-Kincaid Grade、Gunning Fog）与站点完全一致，保证正常英文输入下结果相同。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 音节数用启发式规则估算，不是词典查表，长词与专有名词会有偏差
 *        （这是所有 Flesch 实现的共同局限，非本实现特有）。
 *   [L2] Gunning Fog 的「复杂词」判定依赖音节估算，误差会被放大。
 *   [L3] 分数面向英文文本设计；对中文等语言，Flesch 系列本身不适用（已在 warnings 报告）。
 */

export const CAPABILITY = Object.freeze({
  id: 'text/readability',
  version: '1.0.0',
  sourceTool: 'ai-detection-readability-score',
  deterministic: true,
  networkAccess: false,
});

/** 规则命中即视为该缩写，不在此处断句。 */
const ABBREVIATIONS = [
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
  'a.m', 'p.m', 'u.s', 'u.k', 'no', 'fig', 'al', 'inc', 'ltd', 'co', 'dept', 'est',
];

const LATIN_ONLY = /^[a-z'’-]+$/;

/** 不规则过去分词（用于被动语态判定，避免 ed/en 之外的分词被漏掉）。 */
const IRREGULAR_PARTICIPLES = new Set([
  'born', 'bought', 'broken', 'built', 'caught', 'chosen', 'cut', 'done', 'drawn',
  'driven', 'eaten', 'fallen', 'fed', 'felt', 'found', 'given', 'gone', 'grown',
  'held', 'hidden', 'hit', 'hurt', 'kept', 'known', 'laid', 'led', 'left', 'lent',
  'let', 'lost', 'made', 'meant', 'met', 'paid', 'put', 'read', 'run', 'said',
  'seen', 'sent', 'set', 'shown', 'sold', 'sought', 'spent', 'split', 'spoken',
  'taken', 'taught', 'thought', 'thrown', 'told', 'torn', 'understood', 'won',
  'worn', 'written',
]);

const BE_VERBS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am']);

/** 与原工具完全一致的音节估算启发式。 */
export function countSyllables(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  w = w.replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}

function isComplexWord(word) {
  if (countSyllables(word) < 3) return false;
  if (/[^aeiou][aeiouy]+[^aeiouy]e[sd]?$/.test(String(word).toLowerCase())) return false;
  return true;
}

export function splitWords(text) {
  return String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
}

/**
 * 切句。
 *
 * [F5] 站点实现用的是 `/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g`，
 * 该正则有结构性缺陷：`[^.!?]+` 不能跨越终止符，因此当终止符后面不是空白时
 * （缩写、小数点、域名），它会从**更靠后的位置**重新起匹配，把终止符之前的
 * 整段文字直接丢掉。实测 `Use a tool, e.g. a calculator.` 会被切成
 * `['g.', 'a calculator.']` —— 前半句人间蒸发，却仍然算作 1 句，
 * 于是句数看起来正常、句子内容却是错的，比报错更难发现。
 *
 * 本实现改为按索引扫描：只在「真正的句末终止符」处切分，绝不丢片段。
 */
export function splitSentences(text) {
  const src = String(text || '');
  const out = [];
  if (!src.trim()) return out;

  const isAbbrevToken = (raw) => {
    const lower = raw.toLowerCase();
    return (
      ABBREVIATIONS.includes(lower) ||
      /^[A-Z]$/.test(raw) || // 人名首字母 J. / R.（大小写敏感，冠词 "a" 不会被误判）
      /^([A-Za-z]\.)+[A-Za-z]?$/.test(raw) // U.S. / e.g. / i.e.
    );
  };

  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    let j = i;
    while (j + 1 < src.length && '.!?'.includes(src[j + 1])) j++;

    const after = src[j + 1];
    if (after !== undefined && !/\s/.test(after)) {
      i = j; // 不是句末（小数点 / 缩写中间 / 域名），继续
      continue;
    }

    const head = src.slice(start, i).trim();
    const lastTokenRaw = head.split(/[\s(]+/).pop() || '';
    if (isAbbrevToken(lastTokenRaw)) {
      i = j;
      continue;
    }

    const sentence = src.slice(start, j + 1).trim();
    if (sentence) out.push(sentence);
    start = j + 1;
    i = j;
  }

  const rest = src.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

function splitParagraphs(text) {
  return String(text || '').split(/\n\s*\n+/).filter((p) => p.trim().length > 0);
}

/** 被动语态判定：be 动词 + (过去分词)。[F1] 修正了 "is not" 类误报。 */
function isPassiveSentence(sentence) {
  const tokens = String(sentence).toLowerCase().match(/[a-z]+/g) || [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!BE_VERBS.has(tokens[i])) continue;
    let j = i + 1;
    // 跳过副词（is not / was quickly finished）
    while (j < tokens.length && (tokens[j].endsWith('ly') || tokens[j] === 'not' || tokens[j] === 'never')) j++;
    const cand = tokens[j];
    if (!cand) continue;
    if (cand.endsWith('ed') || cand.endsWith('en') || IRREGULAR_PARTICIPLES.has(cand)) return true;
  }
  return false;
}

/**
 * 分析文本可读性。
 *
 * @param {string} text
 * @returns {object} 结构化结果，含 scores / passive / longSentences / warnings
 */
export function analyzeReadability(text) {
  const input = text == null ? '' : String(text);
  const empty = {
    status: 'empty',
    wordCount: 0, sentenceCount: 0, paragraphCount: 0, syllableCount: 0, complexWordCount: 0,
    avgSentenceLength: 0, avgSyllablesPerWord: 0,
    scores: { fleschReadingEase: null, fleschKincaidGrade: null, gunningFog: null },
    passive: { count: 0, ratio: 0, sentences: [] },
    longestSentence: 0, longSentences: [], warnings: [],
  };
  if (!input.trim()) return empty;

  const words = splitWords(input);
  const sentences = splitSentences(input);
  const paragraphs = splitParagraphs(input);

  const latinWords = words.filter((w) => LATIN_ONLY.test(w.toLowerCase()));
  const nonLatinWords = words.length - latinWords.length;
  const warnings = [];

  // 先判「有没有可计算的对象」，再判「够不够长」——
  // 否则整段中文（无空格 → 只切出 1~2 个 token）会被误判为 empty。
  if (words.length > 0 && latinWords.length === 0) {
    return {
      status: 'notApplicable',
      wordCount: words.length, sentenceCount: sentences.length, paragraphCount: paragraphs.length,
      syllableCount: 0, complexWordCount: 0,
      avgSentenceLength: sentences.length ? Math.round((words.length / sentences.length) * 10) / 10 : 0,
      avgSyllablesPerWord: 0,
      scores: { fleschReadingEase: null, fleschKincaidGrade: null, gunningFog: null },
      passive: { count: 0, ratio: 0, sentences: [] },
      longestSentence: maxSentenceWords(sentences),
      longSentences: [],
      warnings: [
        `文本含 ${words.length} 个词但没有可参与计算的拉丁词；Flesch / Fog 分数对这类文本不适用` +
          '（本能力返回 null，而不是给出一个看似有效的错数字）',
      ],
    };
  }

  if (words.length < 3 || sentences.length < 1) {
    return { ...empty, status: 'empty', wordCount: words.length, sentenceCount: sentences.length, paragraphCount: paragraphs.length };
  }

  let syllableCount = 0;
  let complexWordCount = 0;
  for (const w of latinWords) {
    syllableCount += countSyllables(w);
    if (isComplexWord(w)) complexWordCount++;
  }

  const wordCount = words.length;
  const sentenceCount = sentences.length;
  const avgSentenceLength = wordCount / sentenceCount;
  const latinRatio = wordCount === 0 ? 0 : latinWords.length / wordCount;

  if (nonLatinWords > 0) {
    warnings.push(
      `文本含 ${nonLatinWords} 个非拉丁词（占 ${Math.round((1 - latinRatio) * 100)}%），` +
        '音节数只对拉丁词有效；Flesch 系列分数对本段不适用，仅供参考'
    );
  }
  if (latinWords.length === 0) {
    return {
      status: 'notApplicable',
      wordCount, sentenceCount, paragraphCount: paragraphs.length,
      syllableCount: 0, complexWordCount: 0,
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      avgSyllablesPerWord: 0,
      scores: { fleschReadingEase: null, fleschKincaidGrade: null, gunningFog: null },
      passive: { count: 0, ratio: 0, sentences: [] },
      longestSentence: maxSentenceWords(sentences),
      longSentences: [],
      warnings: [...warnings, '没有可参与计算的拉丁词，Flesch / Fog 分数不适用（返回 null 而非臆造数字）'],
    };
  }

  // 与原工具一致：公式的分母都用「全部词数」，音节用拉丁词累计值
  const sylPerWord = syllableCount / wordCount;
  const fre = 206.835 - 1.015 * avgSentenceLength - 84.6 * sylPerWord;
  const fk = 0.39 * avgSentenceLength + 11.8 * sylPerWord - 15.59;
  const fog = 0.4 * (avgSentenceLength + 100 * (complexWordCount / wordCount));

  const passiveSentences = sentences.filter(isPassiveSentence);
  const sentInfo = sentences.map((s, i) => ({ index: i + 1, words: splitWords(s).length, text: s }));
  const longSentences = sentInfo.filter((s) => s.words >= 30);

  if (longSentences.length > 0) {
    warnings.push(`有 ${longSentences.length} 句超过 30 词，通常是可读性下降的主因`);
  }

  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;

  return {
    status: 'ok',
    wordCount,
    sentenceCount,
    paragraphCount: paragraphs.length,
    syllableCount,
    complexWordCount,
    avgSentenceLength: r1(avgSentenceLength),
    avgSyllablesPerWord: r2(sylPerWord),
    scores: {
      fleschReadingEase: r1(fre),
      fleschKincaidGrade: r1(fk),
      gunningFog: r1(fog),
    },
    passive: {
      count: passiveSentences.length,
      ratio: Math.round((passiveSentences.length / sentenceCount) * 100),
      sentences: passiveSentences,
    },
    longestSentence: sentInfo.reduce((m, s) => Math.max(m, s.words), 0),
    longSentences,
    warnings,
  };
}

function maxSentenceWords(sentences) {
  return sentences.reduce((m, s) => Math.max(m, splitWords(s).length), 0);
}

/** 与原工具一致的 Flesch Reading Ease 释义区间。 */
export function describeFleschEase(score) {
  if (score === null || score === undefined) return { text: 'Not applicable', level: 'unknown' };
  if (score >= 90) return { text: 'Very easy — 5th-grade level', level: 'very-easy' };
  if (score >= 80) return { text: 'Easy — 6th-grade level', level: 'easy' };
  if (score >= 70) return { text: 'Fairly easy — 7th-grade', level: 'fairly-easy' };
  if (score >= 60) return { text: 'Plain English — 8th-9th grade', level: 'plain' };
  if (score >= 50) return { text: 'Fairly difficult — 10th-12th grade', level: 'fairly-difficult' };
  if (score >= 30) return { text: 'Difficult — college level', level: 'difficult' };
  return { text: 'Very difficult — college graduate level', level: 'very-difficult' };
}
