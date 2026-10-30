/**
 * capability: text/keyword-density
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/marketing-keyword-density-checker
 * 版本：1.0.0
 *
 * 为什么这个能力值得做：
 *   关键词密度是 SEO 与内容审核的**硬性检查项**，必须可复现、可写进 CI。
 *   而且它天然适合 AI Agent 场景：Agent 写完稿子调一次，拿到结构化结果再决定是否重写。
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 原型链污染：站点实现用 `var counts = {}` 统计词频，于是当文本里出现
 *        `constructor` / `toString` / `hasOwnProperty` / `valueOf` / `__proto__`
 *        这类词时，`counts[w]` 取到的是 Object 原型上的成员（一个函数），
 *        `(counts[w] || 0) + 1` 就变成函数与数字相加 —— 输出出现 NaN 或一串
 *        函数源码，且整个统计表被污染。技术类文章里 `constructor` 并不罕见。
 *        本实现改用 Map，从根本上不存在原型链。
 *   [F2] 非拉丁文本被整体丢弃：站点实现先 `replace(/[^\w\s]/g,'')` 再切分，
 *        而 `\w` 只含 ASCII —— 中文、日文、带重音字母的正文会被清空，
 *        统计结果全为 0，界面却照常显示。本实现使用 Unicode 属性的分词，
 *        并把「文本主要是非拉丁字符」作为显式 warning 报出来。
 *   [F3] 空文本返回 1 分钟阅读时间：站点实现 `Math.max(1, ceil(words/200))`，
 *        空文本也报 1 min。本实现返回 0。
 *   [F4] 密度分母语义混乱：站点实现用「含停用词的全部词数」做分母，
 *        但分子来自「已排除停用词」的计数表，于是查询停用词时分子恒为 0。
 *        本实现同时给出两个密度（占全部词 / 占实词），语义各自明确。
 *   [F5] 返回结构化对象，而不是拼好的 HTML 表格。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   密度判定阈值（1%–3% 为 Optimal、>3% Too high、<1% Low）、阅读速度 200 词/分钟、
 *   Top 词条与 2-gram 短语的展示口径与原工具一致。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 停用词表是英文表；对非英文文本需自行传入 stopWords。
 *   [L2] 2-gram 短语按相邻词对统计，不做词形还原（running / runs 视为两个词）。
 *   [L3] 密度只是 SEO 的一个弱指标，不应作为唯一优化目标。
 */

export const CAPABILITY = Object.freeze({
  id: 'text/keyword-density',
  version: '1.0.0',
  sourceTool: 'marketing-keyword-density-checker',
  deterministic: true,
  networkAccess: false,
});

/**
 * 英文停用词表。
 * 原工具的列表缺 a / an / is / it / of / to / in / on / or / as / at 等最高频词，
 * 导致 Top Keywords 常被这类无意义词占据；本表补全，并可通过 options.stopWords 整体替换。
 */
export const DEFAULT_STOP_WORDS = new Set([
  'a', 'able', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am',
  'among', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do',
  'does', 'doing', 'done', 'each', 'few', 'for', 'from', 'further', 'get', 'got',
  'had', 'has', 'have', 'he', 'her', 'here', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'may', 'me', 'might', 'more', 'most', 'must', 'my', 'no', 'not',
  'of', 'on', 'or', 'other', 'our', 'out', 'over', 'own', 'same', 'shall', 'she',
  'should', 'so', 'some', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'under', 'until', 'up', 'us',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'will',
  'with', 'would', 'you', 'your',
]);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const LATIN_RE = /\p{Script=Latin}/u;

/**
 * 分析关键词密度。
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.focusKeyword=''] 要重点跟踪的关键词（整词匹配，大小写不敏感）
 * @param {Set<string>|string[]} [options.stopWords] 自定义停用词表；传空数组则不去停用词
 * @param {number} [options.topN=15] 返回前 N 个关键词
 * @param {number} [options.phraseN=10] 返回前 N 个 2-gram 短语
 * @param {number} [options.wordsPerMinute=200] 阅读速度
 */
export function analyzeKeywordDensity(text, options = {}) {
  const input = text == null ? '' : String(text);
  const focusKeyword = String(options.focusKeyword || '').trim().toLowerCase();
  const stopWords =
    options.stopWords === undefined
      ? DEFAULT_STOP_WORDS
      : new Set([...options.stopWords].map((w) => String(w).toLowerCase()));
  const topN = Number.isInteger(options.topN) ? options.topN : 15;
  const phraseN = Number.isInteger(options.phraseN) ? options.phraseN : 10;
  const wpm = Number(options.wordsPerMinute) > 0 ? Number(options.wordsPerMinute) : 200;

  const warnings = [];
  const rawWords = input.match(WORD_RE) || [];
  const words = rawWords.map((w) => w.toLowerCase());
  const totalWords = words.length;
  const totalCharacters = input.length;

  if (totalWords === 0) {
    return {
      totalWords: 0,
      totalCharacters,
      readingTimeMinutes: 0,
      contentWordCount: 0,
      focus: null,
      topKeywords: [],
      topPhrases: [],
      warnings: ['文本为空或没有可识别的词'],
    };
  }

  const latinCount = rawWords.filter((w) => LATIN_RE.test(w)).length;
  if (latinCount / totalWords < 0.5) {
    warnings.push(
      `文本以非拉丁字符为主（拉丁词占 ${Math.round((latinCount / totalWords) * 100)}%）；` +
        '默认停用词表仅适用于英文，建议传入对应的 stopWords 或留空'
    );
  }

  // [F1] 用 Map，杜绝原型链污染
  const counts = new Map();
  for (const w of words) {
    if (stopWords.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const contentWordCount = [...counts.values()].reduce((a, b) => a + b, 0);

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topCount = sorted.length ? sorted[0][1] : 1;
  const pct2 = (x) => Math.round(x * 10000) / 100;

  const topKeywords = sorted.slice(0, topN).map(([word, count]) => ({
    word,
    count,
    density: pct2(count / totalWords),
    densityOfContentWords: contentWordCount ? pct2(count / contentWordCount) : 0,
    shareOfTop: Math.min(100, Math.round((count / topCount) * 100)),
  }));

  let focus = null;
  if (focusKeyword) {
    const focusCount = counts.get(focusKeyword) || 0;
    const density = pct2(focusCount / totalWords);
    focus = {
      keyword: focusKeyword,
      count: focusCount,
      density,
      densityOfContentWords: contentWordCount ? pct2(focusCount / contentWordCount) : 0,
      verdict: density >= 1 && density <= 3 ? 'optimal' : density > 3 ? 'too-high' : 'low',
      isStopWord: stopWords.has(focusKeyword),
    };
    if (focus.isStopWord) {
      warnings.push(`"${focusKeyword}" 属于停用词，默认统计里不计入，因此 count 恒为 0`);
    }
  }

  // 2-gram：按相邻「非停用词」对统计，避免 "of the" 这类组合霸榜
  const phraseCounts = new Map();
  let prevContent = null;
  for (const w of words) {
    if (stopWords.has(w)) {
      prevContent = null;
      continue;
    }
    if (prevContent !== null) {
      const key = prevContent + ' ' + w;
      phraseCounts.set(key, (phraseCounts.get(key) || 0) + 1);
    }
    prevContent = w;
  }
  const topPhrases = [...phraseCounts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, phraseN)
    .map(([phrase, count]) => ({ phrase, count }));

  return {
    totalWords,
    totalCharacters,
    readingTimeMinutes: Math.ceil(totalWords / wpm),
    contentWordCount,
    focus,
    topKeywords,
    topPhrases,
    warnings,
  };
}
