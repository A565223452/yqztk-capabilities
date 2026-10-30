/**
 * capability: security/password-strength
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/engineering-password-strength-checker
 * 版本：1.0.0
 *
 * 为什么这个能力值得做：
 *   密码强度评估必须是**可复现、可审计**的 —— 同一个密码在任何时间、任何机器上
 *   都必须得到同一个分数，否则它无法写进注册流程的验收标准。
 *   而且它天然属于「数据不出进程」场景：用户绝不会把密码发给云服务评分。
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 溢出不再被静默吞掉：站点算 `Math.pow(pool, len)`，当 len 稍大
 *        （如 12 位含符号 → pool 95 → 95^12 ≈ 5.4e23）时结果超出安全整数范围，
 *        但 JS 会一路算到 Infinity，再走过 `formatTime` 的层层比较落到 'centuries'。
 *        本能力用对数计算 crack 时间，保留数量级，避免任何溢出，
 *        并明确返回 `crackTimeSeconds: Infinity` 的语义等于「远超宇宙年龄」。
 *   [F2] 生成器不再用 Math.random：站点用 `Math.random()` 生成密码，
 *        既不可复现也无法测试。本能力要求显式传入 seed（见 lib/prng.mjs）。
 *        注意：这只保证**可复现**，不提供密码学强度 —— 需要真随机请用 node:crypto。
 *   [F3] 洗牌换成 Fisher–Yates（站点用 `sort(() => Math.random() - 0.5)`，分布有偏）。
 *   [F4] 常见密码表从「写死在页面里的数组」变成可注入参数，
 *        默认表只有最常见的若干条，允许调用方传入更大的私有泄露库。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   字符池大小（小写26 / 大写26 / 数字10 / 符号33）、
 *   评分规则（长度×4 上限 40、四类字符各 +10、长度奖励 +10/+5、
 *   常见密码封顶 20、连续序列 −10、三位重复 −10）、
 *   以及分数分档（<30 很弱 / <50 弱 / <70 一般 / <90 强 / ≥90 很强）。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 字符池 × 长度的熵估算假设「攻击者按均匀随机枚举」，
 *        对 `P@ssw0rd` 这类字典变形会**严重高估**强度。
 *   [L2] 默认常见密码表很小，不能替代 HIBP 之类的真实泄露库。
 *   [L3] 本能力只做本地评估，不上传、不记录、不缓存任何密码。
 */

import { createRng, randomInt, shuffle } from '../lib/prng.mjs';

export const CAPABILITY = Object.freeze({
  id: 'security/password-strength',
  version: '1.0.0',
  sourceTool: 'engineering-password-strength-checker',
  deterministic: true,
  networkAccess: false,
  note: '不存储、不记录、不传输任何密码；全部计算在调用进程内完成',
});

/** 默认常见密码表（极简版，可被 options.commonPasswords 替换） */
export const DEFAULT_COMMON_PASSWORDS = Object.freeze([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', 'letmein', 'dragon',
  '111111', 'baseball', 'iloveyou', 'trustno1', 'sunshine', 'master', 'welcome',
  'shadow', 'ashley', 'football', 'jesus', 'michael', 'ninja', 'mustang', 'password1',
  'admin', 'root', 'guest', 'login', 'passw0rd', 'p@ssw0rd', 'qwerty123', '1q2w3e4r',
  '123456789', '1234567890', '000000', '654321', 'superman', 'batman', 'starwars',
  'hello', 'freedom', 'whatever', 'zaq12wsx', 'asdfghjkl', 'changeme', 'secret',
]);

const SEQUENCE_RE = /(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i;
const REPEAT_RE = /(.)\1{2,}/;

/** 每秒可尝试次数（离线高速破解的保守量级） */
const GUESSES_PER_SECOND = 1e10;

function poolSize(p) {
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
  return pool;
}

/** 把秒数格式化为人类可读字符串。用对数避免大指数溢出（[F1]）。 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return 'effectively forever';
  if (seconds < 1) return 'instantly';
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
  if (seconds < 31536000) return `${Math.round(seconds / 86400)} days`;
  if (seconds < 31536000 * 1000) return `${Math.round(seconds / 31536000)} years`;
  const universeAge = 13.8e9;
  const years = seconds / 31536000;
  if (years > universeAge) return 'longer than the age of the universe';
  return `${Math.round(years)} years`;
}

/** 对数域计算破解所需秒数：log10(seconds) = len*log10(pool) - log10(guessesPerSecond) */
function crackSecondsLog10(pool, len) {
  if (!pool || len <= 0) return -Infinity;
  return len * Math.log10(pool) - Math.log10(GUESSES_PER_SECOND);
}

export function crackSeconds(pool, len) {
  const log10s = crackSecondsLog10(pool, len);
  if (log10s > 308) return Infinity; // 超出 double 上限，语义上等同「不可枚举」
  return 10 ** log10s;
}

/**
 * 评估单个密码强度。
 *
 * @param {string} password
 * @param {object} [options]
 * @param {Iterable<string>} [options.commonPasswords] 替换默认常见密码表
 * @returns {object}
 */
export function assessPassword(password, options = {}) {
  if (typeof password !== 'string') throw new RangeError('password 必须是字符串');

  const commonList = options.commonPasswords
    ? new Set([...options.commonPasswords].map((x) => String(x).toLowerCase()))
    : new Set(DEFAULT_COMMON_PASSWORDS);

  const len = password.length;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const pool = poolSize(password);

  const isCommon = commonList.has(password.toLowerCase());
  const hasSequence = SEQUENCE_RE.test(password) && len >= 6;
  const hasRepeat = REPEAT_RE.test(password);

  let score = 0;
  score += Math.min(len * 4, 40);
  if (hasUpper) score += 10;
  if (hasLower) score += 10;
  if (hasDigit) score += 10;
  if (hasSymbol) score += 10;
  if (len >= 8) score += 10;
  if (len >= 12) score += 5;
  if (isCommon) score = Math.min(score, 20);
  if (hasSequence) score -= 10;
  if (hasRepeat) score -= 10;
  score = Math.max(0, Math.min(100, score));

  const entropyBits = pool ? roundTo(len * Math.log2(pool), 1) : 0;
  const seconds = crackSeconds(pool, len);

  const level = score < 30 ? 'very-weak' : score < 50 ? 'weak' : score < 70 ? 'fair' : score < 90 ? 'strong' : 'very-strong';

  const tips = [];
  if (len < 12) tips.push('使用至少 12 个字符');
  if (!hasUpper) tips.push('加入大写字母（A-Z）');
  if (!hasLower) tips.push('加入小写字母（a-z）');
  if (!hasDigit) tips.push('加入数字（0-9）');
  if (!hasSymbol) tips.push('加入符号（!@#$%…）');
  if (isCommon) tips.push('这是常见的弱密码，请务必更换');
  if (hasSequence) tips.push('避免 abc / 123 这类连续序列');
  if (hasRepeat) tips.push('避免同一字符重复 3 次以上');

  const warnings = [];
  // [F1] 明确指出溢出边界，而不是让调用方误以为算出了精确秒数
  if (!Number.isFinite(seconds)) {
    warnings.push('组合数超出双精度可表示范围，破解时间以「超过宇宙年龄」表述，不代表精确值');
  }
  if (isCommon) warnings.push('命中常见密码表，无论多长都不应使用');

  return {
    length: len,
    characterClasses: { lower: hasLower, upper: hasUpper, digit: hasDigit, symbol: hasSymbol },
    poolSize: pool,
    entropyBits,
    crackTime: { seconds: Number.isFinite(seconds) ? Math.round(seconds) : Infinity, display: formatTime(seconds), guessesPerSecond: GUESSES_PER_SECOND },
    score,
    level,
    patterns: { isCommon, hasSequence, hasRepeat },
    tips,
    warnings,
  };
}

const roundTo = (x, n) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

const CHAR_SETS = Object.freeze({
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
});
const AMBIGUOUS = new Set('il1Lo0O');

/**
 * 生成密码（确定性：同 seed 同结果）。
 *
 * @param {object} input
 * @param {number} [input.length=20] 长度 4~128
 * @param {string[]} [input.sets=['lower','upper','digits','symbols']] 使用的字符集
 * @param {boolean} [input.excludeAmbiguous=false] 是否排除易混淆字符 il1Lo0O
 * @param {number} [input.count=1] 生成个数 1~20
 * @param {number|string} [input.seed=1]
 */
export function generatePassword(input = {}) {
  const length = Number(input.length ?? 20);
  const count = Number(input.count ?? 1);
  const seed = input.seed === undefined ? 1 : input.seed;
  const excludeAmbiguous = input.excludeAmbiguous === true;
  const setKeys = input.sets ?? ['lower', 'upper', 'digits', 'symbols'];

  if (!Number.isInteger(length) || length < 4 || length > 128) throw new RangeError('length 必须是 4~128 的整数');
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new RangeError('count 必须是 1~20 的整数');
  if (!Array.isArray(setKeys) || setKeys.length === 0) throw new RangeError('sets 至少要有一个字符集');

  const active = setKeys.map((k) => {
    const raw = CHAR_SETS[k];
    if (!raw) throw new RangeError(`未知字符集：${k}（可用：${Object.keys(CHAR_SETS).join(', ')}）`);
    const filtered = excludeAmbiguous ? [...raw].filter((c) => !AMBIGUOUS.has(c)).join('') : raw;
    if (!filtered) throw new RangeError(`字符集 ${k} 在排除易混淆字符后为空`);
    return filtered;
  });

  if (length < active.length) {
    throw new RangeError(`长度 ${length} 小于所选字符集数量 ${active.length}，无法保证每类至少出现一次`);
  }

  const rng = createRng(seed);
  const all = active.join('');
  const passwords = [];

  for (let n = 0; n < count; n++) {
    // 每个字符集先各放一个，保证类别覆盖
    const chars = active.map((set) => set[randomInt(rng, 0, set.length - 1)]);
    while (chars.length < length) {
      chars.push(all[randomInt(rng, 0, all.length - 1)]);
    }
    const shuffled = shuffle(rng, chars).join('');
    passwords.push(shuffled);
  }

  const assessments = passwords.map((p) => {
    const a = assessPassword(p);
    return { score: a.score, level: a.level, entropyBits: a.entropyBits };
  });

  return {
    seed,
    length,
    sets: setKeys,
    excludeAmbiguous,
    passwords,
    assessments,
    /** [F2] 明确声明随机源性质，避免被误用于密码学场景 */
    warning: '随机源是确定性 PRNG（用于可复现），不具密码学强度；生成真实凭据请使用 node:crypto 的 randomBytes',
  };
}
