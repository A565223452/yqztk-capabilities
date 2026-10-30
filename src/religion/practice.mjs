/**
 * capability: religion/scripture-memory
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/religion-scripture-memory-tracker
 * 版本：1.0.0
 *
 * 为什么这个能力值得做：
 *   间隔重复（spaced repetition）的核心是**可预测的调度**：
 *   给定「今天」和每个条目的掌握等级，下一批该复习哪些、什么时候再出现，
 *   必须是确定性的、可离线计算的。这正是 AI 给不了的（它不会替你记住日程）。
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 不再读写系统时钟：站点直接用 `Date.now()` 决定「今天该复习什么」，
 *        导致同一个条目在不同时间调用会得到不同结果，无法测试、无法复现。
 *        本能力要求显式传入 `now`（毫秒时间戳或 ISO 字符串）。
 *   [F2] 随机挑选改为可选且可复现：站点用 `Math.random()` 在到期条目里挑一条，
 *        同样的数据每次刷新挑到的都不同。本能力接受 `seed`，
 *        不传 seed 时按「最早到期优先」这一确定性策略排序。
 *   [F3] 等级推进不再静默越界：站点用 `levels[Math.min(idx+1, levels.length-1)]`，
 *        完全掌握后仍会停在最后一档但不说明。本能力返回 `graduated: true`，
 *        并给出「已满级」状态。
 *   [F4] 返回结构化调度结果（due / selected / intervals / nextReviewAt），
 *        而不是直接改 DOM。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   复习间隔表（new:1 天 / 3day:3 天 / weekly:7 天 / biweekly:14 天 / mastered:60 天）
 *   与等级顺序。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 这是固定间隔表，不是 SM-2 / FSRS 那样的自适应算法，不按回忆难度动态调整。
 *   [L2] 不处理时区与「学习日」边界（连续学习日应按时区切分，本能力只做时间戳运算）。
 */

import { createRng, randomInt } from '../lib/prng.mjs';

export const REVIEW_INTERVALS_DAYS = Object.freeze({
  new: 1,
  '3day': 3,
  weekly: 7,
  biweekly: 14,
  mastered: 60,
});

export const LEVELS = Object.freeze(['new', '3day', 'weekly', 'biweekly', 'mastered']);

const DAY_MS = 86400000;

function toTimestamp(value, fieldName) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ts = Date.parse(String(value));
  if (!Number.isFinite(ts)) throw new RangeError(`${fieldName} 不是合法时间：${value}`);
  return ts;
}

/** 归一化一个条目：补齐 level / nextReview 字段。 */
export function normalizeVerse(v, now) {
  if (!v || typeof v !== 'object') throw new RangeError('条目必须是对象');
  const level = LEVELS.includes(v.level) ? v.level : 'new';
  const nextReview = v.nextReview === undefined ? now : toTimestamp(v.nextReview, 'nextReview');
  return {
    ref: String(v.ref ?? ''),
    text: String(v.text ?? ''),
    translation: String(v.translation ?? ''),
    level,
    nextReview,
  };
}

/** 取出所有到期条目（nextReview <= now）。 */
export function getDueVerses(verses, now) {
  const ts = toTimestamp(now, 'now');
  if (!Array.isArray(verses)) throw new RangeError('verses 必须是数组');
  return verses
    .map((v, index) => ({ ...normalizeVerse(v, ts), index }))
    .filter((v) => v.nextReview <= ts)
    .sort((a, b) => a.nextReview - b.nextReview || a.index - b.index);
}

/** 把一个条目推进一档，返回新的 level 与下次复习时间。 */
export function promoteVerse(verse, now) {
  const ts = toTimestamp(now, 'now');
  const v = normalizeVerse(verse, ts);
  const idx = LEVELS.indexOf(v.level);
  const graduated = idx >= LEVELS.length - 1;
  const nextLevel = LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
  const days = REVIEW_INTERVALS_DAYS[nextLevel];
  return {
    ...v,
    level: nextLevel,
    nextReview: ts + days * DAY_MS,
    graduated,
    intervalDays: days,
  };
}

/**
 * 生成一次复习调度。
 *
 * @param {object} input
 * @param {Array} input.verses 条目列表
 * @param {number|string} input.now 当前时间（毫秒时间戳或 ISO 字符串）
 * @param {number|string} [input.seed] 提供时在到期条目中伪随机挑一条；不提供则取最早到期
 * @param {boolean} [input.autoPromote=false] 是否同时对选中项执行升级
 */
export function scheduleScriptureReview(input = {}) {
  const verses = input.verses;
  const now = input.now;
  if (!Array.isArray(verses)) throw new RangeError('verses 必须是数组');

  const ts = toTimestamp(now, 'now');
  const normalized = verses.map((v) => normalizeVerse(v, ts));
  const due = getDueVerses(normalized, ts);

  let selected = null;
  let selectionStrategy;
  if (due.length > 0) {
    if (input.seed !== undefined) {
      const rng = createRng(input.seed);
      selected = due[randomInt(rng, 0, due.length - 1)];
      selectionStrategy = 'seeded-random';
    } else {
      selected = due[0];
      selectionStrategy = 'earliest-due';
    }
  }

  const result = {
    now: ts,
    total: normalized.length,
    dueCount: due.length,
    due: due.map(({ index, ref, level, nextReview }) => ({ index, ref, level, nextReview })),
    selectionStrategy,
    selected: null,
    promoted: null,
    intervals: REVIEW_INTERVALS_DAYS,
    levels: LEVELS,
    warnings: [],
  };

  if (selected) {
    result.selected = {
      index: selected.index,
      ref: selected.ref,
      level: selected.level,
      text: selected.text,
      translation: selected.translation,
      overdueMs: ts - selected.nextReview,
    };
    if (input.autoPromote) {
      result.promoted = promoteVerse(selected, ts);
      if (result.promoted.graduated) {
        result.warnings.push(`${selected.ref} 已达最高等级（mastered），继续复习以 60 天为周期维持`);
      }
    }
  } else if (normalized.length > 0) {
    const nextUp = normalized.slice().sort((a, b) => a.nextReview - b.nextReview)[0];
    result.nextDueAt = nextUp.nextReview;
    result.nextDueRef = nextUp.ref;
  } else {
    result.warnings.push('条目列表为空');
  }

  return result;
}

export const CAPABILITY = Object.freeze({
  id: 'religion/scripture-memory',
  version: '1.0.0',
  sourceTool: 'religion-scripture-memory-tracker',
  deterministic: true,
  networkAccess: false,
  /** 涉及的经文文本由调用方提供；本能力不内置任何译本，也不联网获取 */
  note: '不内置经文文本、不联网，只做调度运算',
});
