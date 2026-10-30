/**
 * @yqztk/capabilities — Verifiable + Private compute layer
 * ============================================================
 * 由 yuanqizhike.com 的单页工具沉淀出的无头能力层。
 *
 * 三条设计约束（每一个能力都必须满足）：
 *   1. Deterministic  —— 相同输入必得相同输出，无随机、无时间、无环境依赖
 *   2. Private        —— 零网络访问，数据不离开调用进程
 *   3. Auditable      —— 失败边界明确（抛错而非静默），并尽量返回「做了什么」的轨迹
 *
 * 两条实现纪律：
 *   · 涉及随机的能力一律要求显式 seed（见 lib/prng.mjs），绝不使用 Math.random
 *   · 涉及时间的能力一律要求显式 now，绝不读取系统时钟
 *
 * 依赖树为空（package.json 无 dependencies）。这不是洁癖：
 * 「可作为依赖被审计」是本层的卖点之一，只要引入一个传递依赖，审计范围就失控。
 */

export { maskPII, maskText, CAPABILITY as MASK_PII } from './privacy/mask-pii.mjs';
export { buildSchedule, monthlyPayment, CAPABILITY as AMORTIZATION } from './finance/amortization.mjs';
export { calcMortgage, calcCarPayment, simulateLoanPayoff, calcCommissionSplit } from './finance/loans.mjs';
export { analyzeReadability, countSyllables, splitSentences, describeFleschEase, CAPABILITY as READABILITY } from './text/readability.mjs';
export { analyzeKeywordDensity, DEFAULT_STOP_WORDS, CAPABILITY as KEYWORD_DENSITY } from './text/keyword-density.mjs';
export { countSocialCaption, generateLorem, shuffleWords, PLATFORM_LIMITS } from './text/writing.mjs';
export { computeBMI, CAPABILITY as BMI } from './health/bmi.mjs';
export { estimateBAC, analyzeBodyMeasurements, BAC_DISCLAIMER } from './health/body.mjs';
export { beaufortFromSpeed, beaufortFromMetersPerSecond, CAPABILITY as BEAUFORT } from './weather/beaufort.mjs';
export { calcApparentTemperature, heatIndexFahrenheit, windChillFahrenheit } from './weather/comfort.mjs';
export {
  convertCrochetHook, mixModelPaint, mixNailPolish, planHairColor,
  parseHex, rgbToHex, mixRgb, CROCHET_HOOKS,
} from './units/craft.mjs';
export { convertColor, parseColor, contrastRatio, relativeLuminance } from './units/color.mjs';
export { convertAspectRatio, calcPrintSize, estimateAudioFileSize, PRINT_SIZES, AUDIO_FORMAT_KEYS } from './media/imaging.mjs';
export {
  calcPollingMargin, calcMeetingCost, splitTip, calcAquariumStock, FISH_COMPATIBILITY,
} from './business/metrics.mjs';
export { diffDates, shiftDate, formatCountdown, estimateHikingTime, calcReadingTime } from './time/scheduling.mjs';
export { assessPassword, generatePassword, crackSeconds, DEFAULT_COMMON_PASSWORDS } from './security/password.mjs';
export { scheduleScriptureReview, promoteVerse, getDueVerses, REVIEW_INTERVALS_DAYS, LEVELS } from './religion/practice.mjs';
export { generateEscapeRoomPuzzle, analyzeManaCurve, PUZZLE_TYPES } from './gaming/puzzles.mjs';
export { createRng, normalizeSeed, randomInt, pickOne, shuffle, weightedIndex } from './lib/prng.mjs';
export { createProtocolHandler, handleLine, TOOLS as MCP_TOOLS, TOOL_NAMES, SERVER_INFO } from './mcp/server.mjs';

/**
 * 已实现能力的清单，供 MCP server / 文档站 / README 自动生成使用。
 * fromTool 是站点上的对应工具 slug；修正项编号见各能力源码头部注释。
 */
export const REGISTRY = Object.freeze([
  // ── privacy / security ──
  { id: 'privacy/mask-pii', version: '1.0.0', fromTool: 'security-data-masker', entry: './privacy/mask-pii.mjs', summary: 'Mask PII (email / phone / card / SSN / IP / ZIP) with an audit trail of every replacement.' },
  { id: 'security/password-strength', version: '1.0.0', fromTool: 'engineering-password-strength-checker', entry: './security/password.mjs', summary: 'Password score, entropy, overflow-safe crack time, pattern checks and reproducible generation.' },
  // ── finance ──
  { id: 'finance/amortization', version: '1.0.0', fromTool: 'finance-amortization-schedule-generator', entry: './finance/amortization.mjs', summary: 'Equal-payment loan schedule in integer cents with three closing identity checks.' },
  { id: 'finance/loans', version: '1.0.0', fromTool: 'real-mortgage-calculator', entry: './finance/loans.mjs', summary: 'Mortgage PITI, car payment, payoff simulation with savings, and commission split.' },
  // ── text ──
  { id: 'text/readability', version: '1.0.0', fromTool: 'ai-detection-readability-score', entry: './text/readability.mjs', summary: 'Flesch / Flesch-Kincaid / Gunning Fog with passive voice and long-sentence detection.' },
  { id: 'text/keyword-density', version: '1.0.0', fromTool: 'marketing-keyword-density-checker', entry: './text/keyword-density.mjs', summary: 'Keyword density, focus-keyword verdict and 2-gram phrases; prototype-pollution immune.' },
  { id: 'text/writing', version: '1.0.0', fromTool: 'social-instagram-character-counter', entry: './text/writing.mjs', summary: 'Social caption counting in graphemes, plus seeded lorem ipsum generation.' },
  // ── health ──
  { id: 'health/bmi', version: '1.0.0', fromTool: 'health-bmi-calculator', entry: './health/bmi.mjs', summary: 'BMI with WHO classification and healthy weight range; accepts no age/gender.' },
  { id: 'health/body', version: '1.0.0', fromTool: 'health-bac-calculator', entry: './health/body.mjs', summary: 'Widmark BAC estimate and body measurement analysis (BMI, WHR, shape).' },
  // ── weather ──
  { id: 'weather/beaufort', version: '1.0.0', fromTool: 'weather-beaufort-wind-scale', entry: './weather/beaufort.mjs', summary: 'Beaufort force 0–12 on GB/T 28591-2012 intervals; fixes hurricane-force underestimation.' },
  { id: 'weather/comfort', version: '1.0.0', fromTool: 'weather-apparent-temperature-calc', entry: './weather/comfort.mjs', summary: 'Apparent temperature with explicit formula selection and applicability reporting.' },
  // ── units / media ──
  { id: 'units/craft', version: '1.0.0', fromTool: 'hobbies-crochet-hook-converter', entry: './units/craft.mjs', summary: 'Crochet hook sizes, model paint ratios (drops conserved), nail polish blending, hair colour plan.' },
  { id: 'units/color-format', version: '1.0.0', fromTool: 'design-color-format-converter', entry: './units/color.mjs', summary: 'HEX/RGB/HSL/HSV conversion with WCAG luminance and contrast; round-trip reversible.' },
  { id: 'media/imaging', version: '1.0.0', fromTool: 'photography-photo-print-resizer', entry: './media/imaging.mjs', summary: 'Aspect ratios, print size and crop advice, and audio file size estimation.' },
  // ── business ──
  { id: 'business/metrics', version: '1.0.0', fromTool: 'news-polling-margin-calculator', entry: './business/metrics.mjs', summary: 'Polling margin of error, meeting cost, bill/tip splitting, aquarium stocking.' },
  // ── time ──
  { id: 'time/scheduling', version: '1.0.0', fromTool: 'utilities-date-calculator', entry: './time/scheduling.mjs', summary: 'UTC date diff/shift with month clamping, countdown, hiking time, reading time.' },
  // ── religion / gaming ──
  { id: 'religion/scripture-memory', version: '1.0.0', fromTool: 'religion-scripture-memory-tracker', entry: './religion/practice.mjs', summary: 'Spaced-repetition scheduling for memorisation, with explicit now/seed.' },
  { id: 'gaming/puzzles', version: '1.0.0', fromTool: 'gaming-escape-room-puzzle-gen', entry: './gaming/puzzles.mjs', summary: 'Seeded escape-room puzzle generation and trading-card mana curve analysis.' },
]);

/** MCP 接入信息（可直接贴进客户端配置）。 */
export const MCP_ENTRY = Object.freeze({
  transport: 'stdio',
  command: 'node',
  args: ['bin/mcp-server.mjs'],
});

export const CAPABILITY_COUNT = REGISTRY.length;
