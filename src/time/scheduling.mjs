/**
 * capability 组：日期与时长
 * ============================================================
 * 覆盖来源工具：
 *   - utilities-date-calculator             日期差 / 日期加减
 *   - time-countdown-generator              倒计时分解
 *   - outdoors-hiking-time-calculator       徒步时间与补给估算
 *   - education-reading-time-calculator     阅读/朗读时长
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] 时区不再影响结果：站点用 `new Date(str + 'T00:00:00')` 按**运行环境的
 *        本地时区**解析，同一份输入在北京和纽约会得出不同的日期差。
 *        这直接违反 Deterministic 约束。本能力统一按 UTC 解析与推进，
 *        结果与调用机器的时区无关。
 *   [F2] 「加一个月」不再溢出：JS 的 `setMonth` 遇到 1 月 31 日 +1 月会得到 3 月 3 日
 *        （因为 2 月 31 日不存在，自动向后溢出）。站点直接继承了这个行为。
 *        本能力把结果钳制在目标月的最后一天（1/31 + 1 月 = 2/28 或 2/29），
 *        并在返回值里标记 `clamped: true`，让调用方知道发生过钳制。
 *   [F3] 倒计时不再依赖系统时钟：站点直接读 `Date.now()`，无法复现、无法测试。
 *        本能力要求显式传入 `now`。
 *   [F4] 徒步估算的各乘数顺序与来源显式化：站点把「体能修正 / 地形修正 / 负重
 *        / 休息 / 安全余量」混在一个越写越长的表达式里，中间量不可见。
 *        本能力返回逐项拆解，且每一项都能被独立核对。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 日期计算只处理公历，不含农历、闰秒、历史历法切换。
 *   [L2] 徒步时间是经验公式（含 +10% 安全余量），不适用于技术攀登、雪线以上路段。
 *   [L3] 阅读/朗读速度是平均值，专业内容与母语非母语者会明显偏离。
 */

const round = (x, n = 2) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

const MS_PER_DAY = 86400000;

function parseISODate(input, fieldName) {
  const s = String(input ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new RangeError(`${fieldName} 必须是 YYYY-MM-DD 格式，收到：${input}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ts = Date.UTC(y, mo - 1, d);
  const check = new Date(ts);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`${fieldName} 不是合法日期：${input}`);
  }
  return ts;
}

const toISO = (ts) => new Date(ts).toISOString().slice(0, 10);

const daysInMonthUTC = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * 两个日期之间的差。
 *
 * @param {string} startISO YYYY-MM-DD
 * @param {string} endISO YYYY-MM-DD
 * @returns {object} 日历差（年月日）+ 总天数 / 周 / 小时 / 分钟
 */
export function diffDates(startISO, endISO) {
  const startTs = parseISODate(startISO, 'startISO');
  const endTs = parseISODate(endISO, 'endISO');
  const sign = endTs >= startTs ? 1 : -1;
  const [aTs, bTs] = sign === 1 ? [startTs, endTs] : [endTs, startTs];
  const totalDays = Math.round((bTs - aTs) / MS_PER_DAY);

  // 日历差（年月日）：先按年推，再按月推，余下按天
  const a = new Date(aTs);
  const b = new Date(bTs);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  let months = b.getUTCMonth() - a.getUTCMonth();
  let days = b.getUTCDate() - a.getUTCDate();
  if (days < 0) {
    months -= 1;
    const prevMonthDays = daysInMonthUTC(
      b.getUTCFullYear(),
      (b.getUTCMonth() - 1 + 12) % 12
    );
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return {
    start: toISO(startTs),
    end: toISO(endTs),
    order: sign === 1 ? 'forward' : 'backward',
    totalDays,
    calendar: { years, months, days },
    total: {
      weeks: Math.floor(totalDays / 7),
      remainderDays: totalDays % 7,
      hours: totalDays * 24,
      minutes: totalDays * 24 * 60,
    },
  };
}

/**
 * 日期加减。
 *
 * @param {string} baseISO YYYY-MM-DD
 * @param {object} op
 * @param {number} op.amount 正数
 * @param {'days'|'weeks'|'months'|'years'} op.unit
 * @param {'add'|'subtract'} [op.operator='add']
 */
export function shiftDate(baseISO, op = {}) {
  const baseTs = parseISODate(baseISO, 'baseISO');
  const amount = Number(op.amount);
  const unit = op.unit;
  const operator = op.operator ?? 'add';

  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError('amount 必须是正整数');
  if (!['days', 'weeks', 'months', 'years'].includes(unit)) {
    throw new RangeError("unit 只能是 'days' / 'weeks' / 'months' / 'years'");
  }
  if (!['add', 'subtract'].includes(operator)) throw new RangeError("operator 只能是 'add' 或 'subtract'");
  const dir = operator === 'add' ? 1 : -1;

  const d = new Date(baseTs);
  let clamped = false;

  if (unit === 'days' || unit === 'weeks') {
    const deltaDays = unit === 'days' ? amount : amount * 7;
    d.setUTCDate(d.getUTCDate() + dir * deltaDays);
  } else {
    // [F2] 月份/年份推进时把日期钳制到目标月的最后一天，避免 JS 的溢出行为
    const deltaMonths = unit === 'months' ? amount : amount * 12;
    const originDay = d.getUTCDate();
    const targetMonthIndex = d.getUTCMonth() + dir * deltaMonths;
    const targetYear = d.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
    const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
    const maxDay = daysInMonthUTC(targetYear, normalizedMonth);
    const useDay = Math.min(originDay, maxDay);
    if (useDay !== originDay) clamped = true;
    d.setUTCFullYear(targetYear, normalizedMonth, useDay);
  }

  return {
    base: toISO(baseTs),
    operator,
    amount,
    unit,
    result: d.toISOString().slice(0, 10),
    /** [F2] 是否因目标月没有该日而发生钳制 */
    clamped,
  };
}

/**
 * 倒计时分解。
 *
 * @param {string} targetISO 目标时间（ISO 8601，可含时间）
 * @param {string} [nowISO] 当前时间；**必传**才能在测试中复现（[F3]）
 * @returns {object}
 */
export function formatCountdown(targetISO, nowISO) {
  const targetTs = Date.parse(String(targetISO));
  if (!Number.isFinite(targetTs)) throw new RangeError(`targetISO 不是合法时间：${targetISO}`);
  if (nowISO === undefined) throw new RangeError('必须显式提供 nowISO（站点原实现读系统时钟，无法复现）');
  const nowTs = Date.parse(String(nowISO));
  if (!Number.isFinite(nowTs)) throw new RangeError(`nowISO 不是合法时间：${nowISO}`);

  const rawDiff = targetTs - nowTs;
  const expired = rawDiff < 0;
  const diff = Math.abs(rawDiff);

  const days = Math.floor(diff / MS_PER_DAY);
  const hours = Math.floor((diff % MS_PER_DAY) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const totalSeconds = Math.floor(diff / 1000);

  const pad = (n) => String(n).padStart(2, '0');

  return {
    target: new Date(targetTs).toISOString(),
    now: new Date(nowTs).toISOString(),
    expired,
    diffMs: rawDiff,
    breakdown: { days, hours, minutes, seconds },
    totalSeconds,
    total: {
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.floor(totalSeconds / 60),
      days: Math.floor(totalSeconds / 86400),
      weeks: Math.floor(totalSeconds / 604800),
    },
    display: `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
}

const FITNESS_MODIFIERS = Object.freeze({ slow: 1.3, average: 1.0, fit: 0.8, elite: 0.6 });
const TERRAIN_MODIFIERS = Object.freeze({ trail: 1.0, rough: 1.2, off: 1.5 });
const BASE_PARAMS = Object.freeze({ speedKmh: 5, ascentRateMPerHour: 600, descentRateMPerHour: 900 });

/**
 * 徒步时间与补给估算。
 *
 * @param {object} input
 * @param {number} input.distanceKm
 * @param {number} [input.elevationGainM=0]
 * @param {number} [input.elevationLossM=0]
 * @param {number} [input.packKg=0]
 * @param {'slow'|'average'|'fit'|'elite'} [input.fitness='average']
 * @param {'trail'|'rough'|'off'} [input.terrain='trail']
 * @param {boolean} [input.includeSafetyMargin=true] 是否附加 10% 安全余量
 * @param {boolean} [input.includeBreaks=true] 是否计入每整小时 5 分钟休息
 */
export function estimateHikingTime(input = {}) {
  const distanceKm = Number(input.distanceKm);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) throw new RangeError('distanceKm 必须是大于 0 的数值');

  const gain = Number(input.elevationGainM ?? 0);
  const loss = Number(input.elevationLossM ?? 0);
  const packKg = Number(input.packKg ?? 0);
  if (gain < 0 || loss < 0) throw new RangeError('爬升/下降不能为负');
  if (packKg < 0) throw new RangeError('packKg 不能为负');

  const fitness = input.fitness ?? 'average';
  const terrain = input.terrain ?? 'trail';
  if (!(fitness in FITNESS_MODIFIERS)) throw new RangeError(`fitness 只能是 ${Object.keys(FITNESS_MODIFIERS).join(' / ')}`);
  if (!(terrain in TERRAIN_MODIFIERS)) throw new RangeError(`terrain 只能是 ${Object.keys(TERRAIN_MODIFIERS).join(' / ')}`);

  const includeSafetyMargin = input.includeSafetyMargin !== false;
  const includeBreaks = input.includeBreaks !== false;

  const baseHours = distanceKm / BASE_PARAMS.speedKmh;
  const ascentHours = gain / BASE_PARAMS.ascentRateMPerHour;
  const descentHours = loss / BASE_PARAMS.descentRateMPerHour;

  const movingHours = baseHours + ascentHours + descentHours;
  const fitnessFactor = FITNESS_MODIFIERS[fitness];
  const terrainFactor = TERRAIN_MODIFIERS[terrain];
  const packFactor = packKg > 15 ? 1 + (packKg - 15) * 0.01 : 1;

  let hours = movingHours * fitnessFactor * terrainFactor * packFactor;
  const afterModifiers = hours;

  let breakHours = 0;
  if (includeBreaks) {
    breakHours = (Math.floor(hours) * 5) / 60;
    hours += breakHours;
  }

  let longDayHours = 0;
  if (hours >= 4) {
    longDayHours = 0.5;
    hours += longDayHours; // 长距离通常需要一次正式用餐
  }

  const beforeMargin = hours;
  if (includeSafetyMargin) hours *= 1.1;

  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  const calorieFactor = fitness === 'slow' ? 1.2 : fitness === 'elite' ? 0.8 : 1.0;
  const warnings = [];
  if (gain > 2000) warnings.push('累计爬升超过 2000 m，属于高强度行程，建议按两日安排');
  if (loss > gain + 1000) warnings.push('下降显著多于爬升，注意下坡对膝盖的负荷');

  return {
    input: { distanceKm, elevationGainM: gain, elevationLossM: loss, packKg, fitness, terrain },
    components: {
      baseHours: round(baseHours, 2),
      ascentHours: round(ascentHours, 2),
      descentHours: round(descentHours, 2),
      movingHours: round(movingHours, 2),
      afterModifiers: round(afterModifiers, 2),
      breakHours: round(breakHours, 2),
      longDayAllowance: longDayHours,
      beforeSafetyMargin: round(beforeMargin, 2),
    },
    modifiers: { fitness: fitnessFactor, terrain: terrainFactor, pack: round(packFactor, 3) },
    totalHours: round(hours, 2),
    duration: { hours: h, minutes: m, display: `${h}h ${String(m).padStart(2, '0')}m` },
    supplies: {
      calories: Math.round(distanceKm * 50 * calorieFactor),
      waterLiters: Math.ceil(hours * 0.5),
    },
    warnings,
  };
}

/**
 * 阅读 / 朗读时长估算。
 *
 * @param {object} input
 * @param {string} input.text 正文
 * @param {number} [input.readingWpm=200] 默读速度（词/分钟）
 * @param {number} [input.speakingWpm=130] 朗读速度（词/分钟）
 */
export function calcReadingTime(input = {}) {
  const text = input.text == null ? '' : String(input.text);
  const readingWpm = Number(input.readingWpm ?? 200);
  const speakingWpm = Number(input.speakingWpm ?? 130);
  if (!Number.isFinite(readingWpm) || readingWpm <= 0) throw new RangeError('readingWpm 必须是大于 0 的数值');
  if (!Number.isFinite(speakingWpm) || speakingWpm <= 0) throw new RangeError('speakingWpm 必须是大于 0 的数值');

  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, '').length;

  // [F3] 与站点一致：不足 1 分钟向上取整；但空文本返回 0 而不是 1
  const readMinutes = words === 0 ? 0 : Math.ceil(words / readingWpm);
  const speakMinutes = words === 0 ? 0 : Math.ceil(words / speakingWpm);

  const fmt = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h} hr ${m} min` : `${m} min`;
  };

  return {
    words,
    characters,
    charactersNoSpaces,
    reading: { wordsPerMinute: readingWpm, minutes: readMinutes, display: fmt(readMinutes) },
    speaking: { wordsPerMinute: speakingWpm, minutes: speakMinutes, display: fmt(speakMinutes) },
    warnings: words === 0 ? ['文本为空或没有可识别的词'] : [],
  };
}
