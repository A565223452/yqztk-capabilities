/**
 * MCP 工具清单
 * ============================================================
 * 每个工具 = 一个能力函数的对外门面。description 直接影响模型能否正确选用，
 * 因此必须写清「做什么」「返回什么」「什么情况下不该用」。
 *
 * 抽取规则（每个工具都必须满足）：
 *   · 零网络访问 —— 所有计算在调用进程内完成
 *   · 确定性 —— 含随机的能力一律要求显式 seed；含时间的一律要求显式 now
 *   · 失败边界明确 —— 非法输入抛 RangeError，而不是静默返回空结果
 */

import { maskPII } from '../privacy/mask-pii.mjs';
import { buildSchedule, monthlyPayment } from '../finance/amortization.mjs';
import { analyzeReadability } from '../text/readability.mjs';
import { analyzeKeywordDensity } from '../text/keyword-density.mjs';
import { computeBMI } from '../health/bmi.mjs';
import { beaufortFromSpeed } from '../weather/beaufort.mjs';
import { convertCrochetHook, mixModelPaint, mixNailPolish, planHairColor } from '../units/craft.mjs';
import { convertColor } from '../units/color.mjs';
import { convertAspectRatio, calcPrintSize, estimateAudioFileSize } from '../media/imaging.mjs';
import { calcMortgage, calcCarPayment, simulateLoanPayoff, calcCommissionSplit } from '../finance/loans.mjs';
import { calcPollingMargin, calcMeetingCost, splitTip, calcAquariumStock } from '../business/metrics.mjs';
import { diffDates, shiftDate, formatCountdown, estimateHikingTime, calcReadingTime } from '../time/scheduling.mjs';
import { countSocialCaption, generateLorem } from '../text/writing.mjs';
import { assessPassword, generatePassword } from '../security/password.mjs';
import { estimateBAC, analyzeBodyMeasurements } from '../health/body.mjs';
import { calcApparentTemperature } from '../weather/comfort.mjs';
import { scheduleScriptureReview } from '../religion/practice.mjs';
import { generateEscapeRoomPuzzle, analyzeManaCurve } from '../gaming/puzzles.mjs';

const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const num = (description) => ({ type: 'number', description });
const int = (description) => ({ type: 'integer', description });
const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });
const enumOf = (values, description) => ({ type: 'string', enum: values, description });
const arrOfStr = (description) => ({ type: 'array', items: { type: 'string' }, description });

export const TOOLS = [
  // ── privacy / security ────────────────────────────────────────────────
  {
    name: 'mask_pii',
    title: 'Mask PII in plain text',
    description:
      'Deterministically mask emails, phone numbers, credit cards, SSNs, IP addresses and ZIP codes in a block of text. Runs entirely in-process with zero network access. Returns the masked text plus an audit trail listing every replacement with its exact character offsets, so the result can be verified rather than trusted. Use before sharing logs, tickets or test data. Regex-based masking is not compliance-grade DLP.',
    inputSchema: obj(
      {
        text: str('The text containing data to mask.'),
        types: arrOfStr('Which data types to mask: card, ssn, email, ip, zip, phone. Defaults to all.'),
        style: enumOf(['asterisk', 'full', 'type', 'hash'], 'Masking style. "hash" uses a salted SHA-256 short digest.'),
        salt: str('Salt for the "hash" style. Same salt ⇒ same digest; different salts are unlinkable.'),
      },
      ['text']
    ),
    handler: (a) => maskPII(a.text, { types: a.types, style: a.style, salt: a.salt }),
  },
  {
    name: 'assess_password',
    title: 'Assess password strength',
    description:
      'Score a password locally: character-pool entropy, estimated offline crack time, pattern checks (common password, keyboard/alphabet sequences, repeated characters) and concrete improvement tips. Nothing is uploaded, logged or cached. Crack time is computed in the log domain so very long passwords do not overflow. Note: entropy assumes uniform brute force, so dictionary mutations can be overestimated.',
    inputSchema: obj({ password: str('The password to evaluate. It is never stored or transmitted.') }, ['password']),
    handler: (a) => assessPassword(a.password),
  },
  {
    name: 'generate_password',
    title: 'Generate passwords (reproducible)',
    description:
      'Generate random-looking passwords from a deterministic seed so the same call always returns the same result. Guarantees every selected character class appears at least once. The seed-based RNG is a reproducibility device, NOT cryptographically secure — for real credentials use node:crypto randomBytes instead.',
    inputSchema: obj(
      {
        length: int('Password length, 4–128. Default 20.'),
        sets: arrOfStr('Character sets: lower, upper, digits, symbols. Defaults to all four.'),
        excludeAmbiguous: bool('Exclude visually ambiguous characters (i l 1 L o 0 O).'),
        count: int('How many passwords, 1–20. Default 1.'),
        seed: { type: ['number', 'string'], description: 'Deterministic seed. Same seed ⇒ same output.' },
      },
      []
    ),
    handler: (a) => generatePassword(a),
  },

  // ── finance ───────────────────────────────────────────────────────────
  {
    name: 'build_amortization_schedule',
    title: 'Build a loan amortization schedule',
    description:
      'Compute an equal-payment (annuity) loan schedule using integer-cent arithmetic. Returns the monthly payment, the full period-by-period schedule, totals, and three identity checks (sum of principal equals the loan, sum of interest is consistent, final balance is exactly zero). Supports 0% interest. Use this instead of asking a language model to do the arithmetic — the result is reproducible and auditable.',
    inputSchema: obj(
      {
        principal: num('Loan amount (> 0).'),
        annualRatePercent: num('Nominal annual rate in percent, e.g. 6 for 6%. May be 0.'),
        months: int('Number of monthly periods (1–1200).'),
        adjustFinalPayment: bool('Adjust the last payment so the balance closes to exactly zero. Default true.'),
      },
      ['principal', 'annualRatePercent', 'months']
    ),
    handler: (a) => buildSchedule(a),
  },
  {
    name: 'monthly_payment',
    title: 'Quick monthly payment',
    description:
      'Convenience wrapper returning only the equal monthly payment for a loan, computed deterministically in integer cents. Supports 0% interest. Use when you only need the payment figure, not the full schedule.',
    inputSchema: obj(
      { principal: num('Loan amount (> 0).'), annualRatePercent: num('Nominal annual rate in percent. May be 0.'), months: int('Number of monthly periods.') },
      ['principal', 'annualRatePercent', 'months']
    ),
    handler: (a) => ({ monthlyPayment: monthlyPayment(a.principal, a.annualRatePercent, a.months) }),
  },
  {
    name: 'calc_mortgage',
    title: 'Mortgage PITI and yearly schedule',
    description:
      'Compute principal & interest, monthly tax and insurance, the total PITI payment, total interest, and a yearly amortization summary built from the real period-by-period balances (not a payment-count estimate). Handles 0% interest. Flags low down payments. Excludes PMI, HOA and points.',
    inputSchema: obj(
      {
        price: num('Home price.'),
        downPayment: num('Down payment amount. Default 0.'),
        annualRatePercent: num('Nominal annual rate in percent.'),
        years: int('Loan term in years, 1–50. Default 30.'),
        annualTax: num('Annual property tax. Default 0.'),
        annualInsurance: num('Annual insurance premium. Default 0.'),
      },
      ['price', 'annualRatePercent']
    ),
    handler: (a) => calcMortgage(a),
  },
  {
    name: 'calc_car_payment',
    title: 'Car loan payment and total cost',
    description:
      'Compute a car loan monthly payment, total interest, total cost and a full breakdown, with an explicit switch for whether sales tax is financed. Handles 0% financing. Warns on very long terms and very low down payments.',
    inputSchema: obj(
      {
        price: num('Vehicle price.'),
        downPayment: num('Cash down payment. Default 0.'),
        tradeIn: num('Trade-in value. Default 0.'),
        termMonths: int('Term in months, 1–240. Default 60.'),
        annualRatePercent: num('Nominal annual rate in percent. Default 0.'),
        taxPercent: num('Sales tax percent. Default 0.'),
        fees: num('Fees rolled into the loan. Default 0.'),
        taxInLoan: bool('Whether sales tax is financed rather than paid upfront. Default false.'),
      },
      ['price']
    ),
    handler: (a) => calcCarPayment(a),
  },
  {
    name: 'simulate_loan_payoff',
    title: 'Loan payoff vs extra payments',
    description:
      'Simulate paying off a loan with extra monthly payments, a one-off lump sum and/or biweekly payments, then compare against the minimum-payment baseline to report months and interest saved. Refuses (RangeError) when the payment cannot even cover interest, and reports converged:false instead of silently truncating when the simulation hits its period cap.',
    inputSchema: obj(
      {
        balance: num('Current outstanding principal (> 0).'),
        annualRatePercent: num('Nominal annual rate in percent.'),
        monthlyPayment: num('Current monthly payment (> 0).'),
        extraMonthly: num('Extra amount paid each month. Default 0.'),
        lumpSum: num('One-off extra payment at the start. Default 0.'),
        biweekly: bool('Model biweekly payments (two half-payments per month). Default false.'),
      },
      ['balance', 'annualRatePercent', 'monthlyPayment']
    ),
    handler: (a) => simulateLoanPayoff(a),
  },
  {
    name: 'calc_commission_split',
    title: 'Real-estate commission split',
    description:
      'Split a real-estate commission into listing side and buyer side, then apply the agent/brokerage split, and compute the seller net after commission, closing costs and repair credits. Validates that all percentages are in range.',
    inputSchema: obj(
      {
        price: num('Sale price.'),
        commissionPercent: num('Total commission rate in percent (e.g. 5).'),
        listingSharePercent: num('Listing side share of the total commission, 0–100. Default 50.'),
        agentSplitPercent: num('Agent share of the listing commission, 0–100. Default 100.'),
        closingCostPercent: num('Seller closing cost rate in percent. Default 0.'),
        repairsCredit: num('Repair credit conceded to the buyer. Default 0.'),
      },
      ['price', 'commissionPercent']
    ),
    handler: (a) => calcCommissionSplit(a),
  },

  // ── text ──────────────────────────────────────────────────────────────
  {
    name: 'analyze_readability',
    title: 'Score text readability',
    description:
      'Compute Flesch Reading Ease, Flesch-Kincaid Grade and Gunning Fog for English text, plus sentence/paragraph/syllable statistics, passive-voice detection and a list of over-long sentences. Fully deterministic, so the same draft always scores the same — suitable for gating editorial changes. For text with no Latin words the numeric scores are returned as null with a warning instead of a fabricated number.',
    inputSchema: obj({ text: str('The text to analyze.') }, ['text']),
    handler: (a) => analyzeReadability(a.text),
  },
  {
    name: 'analyze_keyword_density',
    title: 'Analyze keyword density',
    description:
      'Compute word counts, reading time, keyword frequency/density and repeated 2-word phrases for a block of text, optionally tracking a focus keyword with an optimal-density verdict (1%–3%). Handles non-Latin scripts and is immune to prototype-chain pollution from words like "constructor" or "toString".',
    inputSchema: obj(
      {
        text: str('The text to analyze.'),
        focusKeyword: str('Keyword to track specifically (case-insensitive).'),
        stopWords: arrOfStr('Replace the default English stop-word list. Pass [] to disable stop words.'),
        topN: int('How many top keywords to return. Default 15.'),
        phraseN: int('How many top 2-word phrases to return. Default 10.'),
        wordsPerMinute: int('Reading speed for the time estimate. Default 200.'),
      },
      ['text']
    ),
    handler: (a) => analyzeKeywordDensity(a.text, { focusKeyword: a.focusKeyword, stopWords: a.stopWords, topN: a.topN, phraseN: a.phraseN, wordsPerMinute: a.wordsPerMinute }),
  },
  {
    name: 'count_social_caption',
    title: 'Count social caption length',
    description:
      'Count characters of a social post against per-platform limits, using user-perceived graphemes (so one emoji counts as one character, not two UTF-16 units). Also reports words, hashtags, mentions, emoji count and line count. The raw UTF-16 length is returned too, for comparison.',
    inputSchema: obj(
      {
        text: str('The caption or bio text.'),
        platform: enumOf(['instagram', 'twitter', 'tiktok', 'facebook', 'youtube', 'linkedin'], 'Target platform. Default instagram.'),
        field: enumOf(['caption', 'bio', 'name'], 'Which limit to apply. Default caption.'),
      },
      ['text']
    ),
    handler: (a) => countSocialCaption(a),
  },
  {
    name: 'generate_lorem',
    title: 'Generate lorem ipsum placeholder text',
    description:
      'Generate placeholder text by paragraphs, sentences, words or characters, driven by a deterministic seed so the same call always yields the same text (unlike Math.random-based generators). Optionally start with the classic "Lorem ipsum" opening.',
    inputSchema: obj(
      {
        unit: enumOf(['paragraphs', 'sentences', 'words', 'characters'], 'Unit to generate. Default paragraphs.'),
        amount: int('How many units. Default 1.'),
        seed: { type: ['number', 'string'], description: 'Deterministic seed. Same seed ⇒ same text.' },
        startWithLorem: bool('Open with the classic sentence. Default true.'),
      },
      []
    ),
    handler: (a) => generateLorem(a),
  },

  // ── health ────────────────────────────────────────────────────────────
  {
    name: 'compute_bmi',
    title: 'Compute BMI',
    description:
      'Compute body-mass index with WHO adult classification, risk level and the healthy weight range for the given height. Accepts metric (cm/kg) or imperial (in/lb). Deliberately does NOT accept age or gender — they are not needed, so they are not collected.',
    inputSchema: obj(
      {
        height: num('Height in cm (metric) or inches (imperial).'),
        weight: num('Weight in kg (metric) or pounds (imperial).'),
        unit: enumOf(['metric', 'imperial'], 'Unit system. Default metric.'),
      },
      ['height', 'weight']
    ),
    handler: (a) => computeBMI(a),
  },
  {
    name: 'estimate_bac',
    title: 'Estimate blood alcohol concentration',
    description:
      'Estimate BAC with the Widmark formula (standard drink = 14 g, elimination 0.015% per hour) and classify the result. Requires explicit biologicalSex because the Widmark r factor differs. For estimation and education only — it ignores drinking pace, food, liver function and medication, and must never be used to judge fitness to drive.',
    inputSchema: obj(
      {
        weight: num('Body weight.'),
        weightUnit: enumOf(['kg', 'lbs'], 'Weight unit. Default kg.'),
        drinks: num('Number of standard drinks (1 = 14 g pure alcohol).'),
        hours: num('Hours since the first drink. Default 0.'),
        biologicalSex: enumOf(['female', 'male'], 'Used only for the Widmark r factor, not for gender identity.'),
      },
      ['weight', 'drinks', 'biologicalSex']
    ),
    handler: (a) => estimateBAC(a),
  },
  {
    name: 'analyze_body_measurements',
    title: 'Analyze body measurements',
    description:
      'Compute BMI with category, waist-to-hip ratio with WHO risk band, and a body-shape classification (hourglass / pear / inverted triangle / apple / rectangle) from bust, waist and hips. Each result is returned separately so it can be checked on its own. Body-shape categories are a folk taxonomy, not a clinical standard.',
    inputSchema: obj(
      {
        biologicalSex: enumOf(['female', 'male'], 'Used for the shape and WHR thresholds.'),
        heightCm: num('Height in cm.'),
        weightKg: num('Weight in kg.'),
        bustCm: num('Bust/chest circumference in cm.'),
        waistCm: num('Waist circumference in cm.'),
        hipsCm: num('Hip circumference in cm.'),
      },
      ['biologicalSex', 'heightCm', 'weightKg', 'bustCm', 'waistCm', 'hipsCm']
    ),
    handler: (a) => analyzeBodyMeasurements(a),
  },

  // ── weather ───────────────────────────────────────────────────────────
  {
    name: 'beaufort_wind_scale',
    title: 'Beaufort wind force',
    description:
      'Convert a wind speed to its Beaufort force (0–12) using the GB/T 28591-2012 / WMO metre-per-second intervals. Returns the force, English and Chinese names, the description, the speed converted into four units, and the lower/upper bound of the matched band. Corrects the underestimation of hurricane-force winds that affects the naive mph lookup table.',
    inputSchema: obj({ speed: num('Wind speed (non-negative).'), unit: enumOf(['mph', 'kmh', 'ms', 'knots'], 'Input unit. Default mph.') }, ['speed']),
    handler: (a) => beaufortFromSpeed(a.speed, a.unit),
  },
  {
    name: 'calc_apparent_temperature',
    title: 'Apparent temperature (heat index / wind chill)',
    description:
      'Compute feels-like temperature by selecting the correct empirical formula: Rothfusz heat index for hot humid conditions, NWS wind chill for cold windy conditions, Australian apparent temperature otherwise, plus an optional solar-radiation correction. Explicitly reports which formula was used and whether each formula was inside its valid range, rather than silently switching.',
    inputSchema: obj(
      {
        temperature: num('Air temperature.'),
        temperatureUnit: enumOf(['C', 'F'], 'Unit of the input temperature. Default C.'),
        humidityPercent: num('Relative humidity 0–100. Default 50.'),
        windSpeed: num('Wind speed (non-negative). Default 0.'),
        windUnit: enumOf(['ms', 'kmh', 'mph', 'knots'], 'Wind speed unit. Default ms.'),
        solarRadiationWm2: num('Solar radiation in W/m². Default 0.'),
        outputUnit: enumOf(['C', 'F'], 'Output unit. Defaults to the input unit.'),
      },
      ['temperature']
    ),
    handler: (a) => calcApparentTemperature(a),
  },

  // ── time ──────────────────────────────────────────────────────────────
  {
    name: 'diff_dates',
    title: 'Difference between two dates',
    description:
      'Compute the difference between two YYYY-MM-DD dates as calendar years/months/days plus total days, weeks, hours and minutes. Parsed in UTC so the result does not depend on the caller machine time zone.',
    inputSchema: obj({ startISO: str('Start date, YYYY-MM-DD.'), endISO: str('End date, YYYY-MM-DD.') }, ['startISO', 'endISO']),
    handler: (a) => diffDates(a.startISO, a.endISO),
  },
  {
    name: 'shift_date',
    title: 'Add or subtract from a date',
    description:
      'Shift a YYYY-MM-DD date by days, weeks, months or years, in UTC. Month shifting is clamped to the last valid day (1月31日 + 1 month = 2月28日) instead of overflowing into the next month, and the response marks clamped:true when that happened.',
    inputSchema: obj(
      {
        baseISO: str('Base date, YYYY-MM-DD.'),
        amount: int('Positive integer amount.'),
        unit: enumOf(['days', 'weeks', 'months', 'years'], 'Unit to shift by.'),
        operator: enumOf(['add', 'subtract'], 'Direction. Default add.'),
      },
      ['baseISO', 'amount', 'unit']
    ),
    handler: (a) => shiftDate(a.baseISO, a),
  },
  {
    name: 'format_countdown',
    title: 'Break down a countdown',
    description:
      'Break the time between two instants into days/hours/minutes/seconds, report whether the target has passed, and give totals in days/hours/minutes. Requires an explicit now value so the result is reproducible (instead of reading the system clock).',
    inputSchema: obj(
      { targetISO: str('Target instant, ISO 8601.'), nowISO: str('Current instant, ISO 8601. Required — do not rely on the system clock.') },
      ['targetISO', 'nowISO']
    ),
    handler: (a) => formatCountdown(a.targetISO, a.nowISO),
  },
  {
    name: 'estimate_hiking_time',
    title: 'Estimate hiking time',
    description:
      'Estimate hiking duration from distance, elevation gain/loss, pack weight, fitness and terrain, using Naismith-style rules (5 km/h flat, +600 m/h ascent, −900 m/h descent) with breaks, a long-day allowance and a 10% safety margin. Returns every component separately so each can be checked, plus calorie and water estimates.',
    inputSchema: obj(
      {
        distanceKm: num('Distance in km.'),
        elevationGainM: num('Cumulative ascent in metres. Default 0.'),
        elevationLossM: num('Cumulative descent in metres. Default 0.'),
        packKg: num('Pack weight in kg. Default 0.'),
        fitness: enumOf(['slow', 'average', 'fit', 'elite'], 'Fitness band. Default average.'),
        terrain: enumOf(['trail', 'rough', 'off'], 'Terrain band. Default trail.'),
      },
      ['distanceKm']
    ),
    handler: (a) => estimateHikingTime(a),
  },
  {
    name: 'calc_reading_time',
    title: 'Reading and speaking time',
    description:
      'Estimate how long a piece of text takes to read silently and to read aloud, from word count and configurable words-per-minute rates. Returns 0 minutes for empty text rather than rounding up to 1.',
    inputSchema: obj(
      { text: str('The text.'), readingWpm: int('Silent reading speed. Default 200.'), speakingWpm: int('Aloud speaking speed. Default 130.') },
      ['text']
    ),
    handler: (a) => calcReadingTime(a),
  },

  // ── units / media ─────────────────────────────────────────────────────
  {
    name: 'convert_crochet_hook',
    title: 'Convert crochet hook sizes',
    description:
      'Convert between US letter, UK number and metric millimetre crochet hook sizes. Supply any one of us / uk / mm and get the full row; when a millimetre value has no exact match it returns the nearest size instead of failing silently.',
    inputSchema: obj(
      { us: str('US hook letter, e.g. "H".'), uk: str('UK hook number, e.g. "8".'), mm: num('Metric size in millimetres, e.g. 5.0.') },
      []
    ),
    handler: (a) => convertCrochetHook(a),
  },
  {
    name: 'mix_model_paint',
    title: 'Mix model paint ratios',
    description:
      'Split a total number of paint drops into base colour, additive and thinner by ratio, using largest-remainder rounding so the three parts always sum exactly to the total. Optionally mixes the two hex colours linearly to preview the result.',
    inputSchema: obj(
      {
        totalDrops: int('Total drops (> 0).'),
        baseRatio: num('Base colour ratio part. Default 1.'),
        mixRatio: num('Additive ratio part. Default 1.'),
        thinner: num('Thinner fraction 0–1. Default 0.'),
        baseHex: str('Optional base colour as #rrggbb.'),
        mixHex: str('Optional additive colour as #rrggbb.'),
      },
      ['totalDrops']
    ),
    handler: (a) => mixModelPaint(a),
  },
  {
    name: 'mix_nail_polish',
    title: 'Mix two nail polish colours',
    description:
      'Blend two hex colours by weight and return the resulting hex, its RGB components, and a 7-step gradient between them. Blending is linear RGB interpolation, which is an approximation of real pigment mixing.',
    inputSchema: obj(
      { color1: str('Primary colour as #rrggbb.'), color2: str('Secondary colour as #rrggbb.'), ratio: num('Weight of colour1, 0–1. Default 0.5.') },
      ['color1', 'color2']
    ),
    handler: (a) => mixNailPolish(a),
  },
  {
    name: 'plan_hair_color',
    title: 'Plan hair colour development',
    description:
      'From a starting and target colour level, compute the required developer volume (10/20/30/40 Vol), processing time window and mixing ratio, plus warnings for extreme lifts or large darkening steps. Amounts assume a 1:1 ratio and a 50 g base.',
    inputSchema: obj(
      { startLevel: int('Starting level, 1–10.'), targetLevel: int('Target level, 1–10.'), hairLengthCm: num('Optional hair length in cm, for volume guidance.') },
      ['startLevel', 'targetLevel']
    ),
    handler: (a) => planHairColor(a),
  },
  {
    name: 'convert_color',
    title: 'Convert colour formats',
    description:
      'Convert a colour between HEX, RGB, HSL and HSV, and additionally compute WCAG relative luminance and contrast ratios against black and white with a suggested text colour. Accepts #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla() and {r,g,b} objects. Throws on unparseable input instead of silently returning nothing.',
    inputSchema: obj({ input: str('Colour string, e.g. "#336699", "rgb(51,102,153)" or "hsl(210,50%,40%)".') }, ['input']),
    handler: (a) => convertColor(a.input),
  },
  {
    name: 'convert_aspect_ratio',
    title: 'Convert aspect ratios',
    description:
      'Resolve an aspect ratio (e.g. "16:9") or a named print size into its simplified ratio, decimal value and orientation, and derive height from width or width from height. Uses greatest-common-divisor simplification instead of raw division.',
    inputSchema: obj(
      {
        ratio: str('Aspect ratio like "16:9".'),
        preset: str('Named size: 4x6, 5x7, 8x10, 8x12, 11x14, 11x17, 13x19, 16x20, 20x30, 24x36, wallet, square8, square12.'),
        width: num('Known width, to derive height.'),
        height: num('Known height, to derive width.'),
        orientation: enumOf(['portrait', 'landscape'], 'Flip a preset size.'),
      },
      []
    ),
    handler: (a) => convertAspectRatio(a),
  },
  {
    name: 'calc_print_size',
    title: 'Check print quality and cropping',
    description:
      'Given photo pixel dimensions, a target print size and a DPI, compute the required pixels, the achieved quality ratios per axis, a sufficient/acceptable/insufficient verdict, and the cropping needed when the photo and print aspect ratios differ. Warns on insufficient pixels and low DPI.',
    inputSchema: obj(
      {
        photoW: int('Photo width in pixels.'),
        photoH: int('Photo height in pixels.'),
        preset: str('Named print size, e.g. 4x6.'),
        printW: num('Custom print width in inches.'),
        printH: num('Custom print height in inches.'),
        dpi: int('Target DPI. Default 300.'),
      },
      ['photoW', 'photoH']
    ),
    handler: (a) => calcPrintSize(a),
  },
  {
    name: 'estimate_audio_file_size',
    title: 'Estimate audio file size',
    description:
      'Estimate the size of an audio file from duration, codec, sample rate, bit depth and channel count. Uncompressed formats use rate × depth/8 × channels × seconds; lossy formats use bitrate × seconds / 8. Unknown format names throw rather than silently yielding zero bytes.',
    inputSchema: obj(
      {
        durationMinutes: num('Duration in minutes.'),
        sampleRate: int('Sample rate in Hz. Default 44100.'),
        bitDepth: int('Bit depth. Default 16.'),
        channels: int('Channel count 1–8. Default 2.'),
        format: str('wav_pcm, wav_compressed, mp3_320, mp3_256, mp3_192, mp3_128, aac_256, aac_128, ogg_192, flac. Default wav_pcm.'),
      },
      ['durationMinutes']
    ),
    handler: (a) => estimateAudioFileSize(a),
  },

  // ── business ──────────────────────────────────────────────────────────
  {
    name: 'calc_polling_margin',
    title: 'Polling margin of error',
    description:
      'Compute the margin of error for a survey proportion, with a confidence-level table (90/95/99) and an optional finite-population correction that is applied only when a population size is supplied — unlike the naive implementation that always corrects. Can also test whether two proportions differ beyond the margin of error.',
    inputSchema: obj(
      {
        sampleSize: int('Sample size (> 0).'),
        percent: num('Observed proportion in percent. Default 50.'),
        confidenceLevel: int('90, 95 or 99. Default 95.'),
        population: num('Population size. Omit to skip the finite-population correction.'),
        comparePercent: num('A second proportion, to test significance.'),
      },
      ['sampleSize']
    ),
    handler: (a) => calcPollingMargin(a),
  },
  {
    name: 'calc_meeting_cost',
    title: 'Meeting cost estimate',
    description:
      'Estimate the cost of a meeting from headcount, salary, duration, an overhead multiplier and an optional opportunity-cost rate, using a configurable annual-hours assumption (default 2080). Returns per-minute and per-person costs plus an equivalent-work-weeks figure derived from the inputs so it can be checked.',
    inputSchema: obj(
      {
        people: int('Number of attendees (> 0).'),
        annualSalaryPerPerson: num('Average annual salary per attendee.'),
        hours: num('Meeting duration in hours (> 0).'),
        overheadMultiplier: num('Overhead multiplier, e.g. 1.5 for +50%. Default 1.'),
        opportunityRate: num('Opportunity cost as a fraction of loaded cost. Default 0.'),
        hoursPerYear: num('Annual working hours assumption. Default 2080.'),
      },
      ['people', 'annualSalaryPerPerson', 'hours']
    ),
    handler: (a) => calcMeetingCost(a),
  },
  {
    name: 'split_tip',
    title: 'Split a bill with tip and tax',
    description:
      'Split a bill into subtotal, tax, tip and grand total, then divide between people either equally or by custom percentages. Supports per-item tip rates and explicit rounding modes, and reports the rounding adjustment instead of hiding it. The per-person amounts always sum back to the total.',
    inputSchema: obj(
      {
        subtotal: num('Bill subtotal, when not using items.'),
        items: { type: 'array', items: obj({ amount: num('Item amount.'), tipPercent: num('Tip percent for this item.'), name: str('Optional item label.') }, ['amount']), description: 'Per-item breakdown with individual tip rates.' },
        tipPercent: num('Flat tip percent, when not using items. Default 0.'),
        taxPercent: num('Tax percent. Default 0.'),
        people: int('Number of people (> 0). Default 1.'),
        splitMode: enumOf(['equal', 'custom'], 'How to divide. Default equal.'),
        customSplit: { type: 'array', items: obj({ name: str('Person label.'), percent: num('Share percent.') }, ['percent']), description: 'Custom shares; must sum to 100.' },
        rounding: enumOf(['none', 'nearest', 'up'], 'Total rounding mode. Default none.'),
      },
      []
    ),
    handler: (a) => splitTip(a),
  },
  {
    name: 'calc_aquarium_stock',
    title: 'Aquarium stocking and compatibility',
    description:
      'Estimate aquarium stocking capacity from volume, filter type and stocking approach, and check fish compatibility from a species table (flagging pairs that must not be housed together). The inch-per-gallon rule is a crude heuristic that understates large or high-waste fish — treat real ammonia/nitrite readings as authoritative.',
    inputSchema: obj(
      {
        volume: num('Tank volume (> 0).'),
        unit: enumOf(['gallons', 'liters'], 'Volume unit. Default gallons.'),
        fishGroups: {
          type: 'array',
          items: obj({ type: str('Species key, e.g. tetra, goldfish, betta.'), sizeInches: num('Adult size in inches.'), quantity: int('How many.') }, ['type', 'sizeInches', 'quantity']),
          description: 'One entry per species group.',
        },
        filterType: enumOf(['basic', 'moderate', 'heavy', 'planted'], 'Filtration level. Default moderate.'),
        approach: enumOf(['conservative', 'moderate', 'heavy'], 'Stocking approach. Default moderate.'),
      },
      ['volume', 'fishGroups']
    ),
    handler: (a) => calcAquariumStock(a),
  },

  // ── gaming / religion ─────────────────────────────────────────────────
  {
    name: 'generate_escape_room_puzzle',
    title: 'Generate an escape-room puzzle',
    description:
      'Generate a puzzle with its solution and a hint, choosing from caesar, substitution, reverse, binary, morse, sequence and riddle. Seeded, so the same call always produces the same puzzle and answer — letting organisers prepare and print a fixed set. Puzzle text and solution are returned as separate fields so the answer can be withheld.',
    inputSchema: obj(
      {
        type: enumOf(['caesar', 'substitution', 'reverse', 'binary', 'morse', 'sequence', 'riddle'], 'Puzzle type. Random if omitted.'),
        difficulty: enumOf(['easy', 'medium', 'hard'], 'Difficulty band. Default medium.'),
        phrase: str('Optional custom plaintext for the phrase-based types.'),
        seed: { type: ['number', 'string'], description: 'Deterministic seed. Required for reproducibility.' },
      },
      []
    ),
    handler: (a) => generateEscapeRoomPuzzle(a),
  },
  {
    name: 'analyze_mana_curve',
    title: 'Analyze a trading-card mana curve',
    description:
      'Suggest a land count and a mana-curve distribution for a deck (default 60 cards), either deriving the curve from a target average cost or validating a supplied distribution, then report the achieved average, advice and any inconsistency between the curve total and the non-land count.',
    inputSchema: obj(
      {
        deckSize: int('Deck size, 40–250. Default 60.'),
        colors: int('Number of colours, 1–5. Default 2.'),
        rampCount: int('Number of ramp pieces. Default 4.'),
        targetAverageCmc: num('Target average converted mana cost, 0–7. Default 2.5.'),
        curve: { type: 'array', items: { type: 'integer' }, description: 'Explicit distribution for costs 0..6 (length 7).' },
      },
      []
    ),
    handler: (a) => analyzeManaCurve(a),
  },
  {
    name: 'schedule_scripture_review',
    title: 'Schedule spaced-repetition review',
    description:
      'Given a list of memorisation items with levels and next-review timestamps, return which items are due, pick one to practise, and optionally advance it to the next interval (1/3/7/14/60 days). Requires an explicit now and uses earliest-due ordering unless a seed is supplied, so the schedule is reproducible. Ships no scripture text and makes no network calls.',
    inputSchema: obj(
      {
        verses: {
          type: 'array',
          items: obj(
            { ref: str('Reference label.'), text: str('Text to memorise.'), translation: str('Optional translation label.'), level: enumOf(['new', '3day', 'weekly', 'biweekly', 'mastered'], 'Current level.'), nextReview: num('Next review timestamp in ms.') },
            ['ref', 'text']
          ),
          description: 'The items to schedule.',
        },
        now: { type: ['number', 'string'], description: 'Current time as an epoch-ms number or ISO string. Required.' },
        seed: { type: ['number', 'string'], description: 'Optional seed to pick pseudo-randomly among due items.' },
        autoPromote: bool('Also advance the selected item to its next level. Default false.'),
      },
      ['verses', 'now']
    ),
    handler: (a) => scheduleScriptureReview(a),
  },
];

/** 供文档站/自检使用：工具名清单 */
export const TOOL_NAMES = TOOLS.map((t) => t.name);
