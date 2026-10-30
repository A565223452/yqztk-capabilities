/**
 * capability: privacy/mask-pii
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/security-data-masker
 * 版本：1.0.0
 *
 * 为什么这个能力值得放在第一批：
 *   它是「第三层护城河」（可验证 + 私有）最典型的形态——用户要处理的恰恰是
 *   最敏感的数据（日志、工单、测试数据），而这类数据在合规上根本不允许送上云。
 *   纯本地、零网络、结果可复现，是 AI 服务在结构上给不了的东西。
 *
 * ── 与站点工具实现的差异（本能力是修正版，不是复刻）─────────────────
 *   [F1] hash 模式：站点 UI 标注 "Hash (SHA-256 short)"，实现用的却是 32 位整数
 *        哈希（`hashStr`，Java String.hashCode 风格）。32 位哈希可在秒级内被暴力
 *        枚举还原 —— 也就是说该模式的输出**不具备脱敏效果**，而界面还告诉用户
 *        它用了 SHA-256。本实现改用 node:crypto 的真实 SHA-256（截取 12 位十六进制），
 *        并支持可选 salt。这是本能力与站点工具**唯一的结果差异**，且是有意为之。
 *   [F2] 新增审计输出：返回 detections 数组，逐条给出「第几到第几字符、
 *        检测为何种类型、被替换成什么」。站点工具只输出替换后的文本，
 *        改了什么无从核对。可审计性是本层的核心卖点。
 *   [F3] 位置精确：采用一次性扫描 + 按位置从后向前替换，而不是链式 replace。
 *        链式 replace 无法给出准确的原始坐标（前一次替换会改变后一次的下标）。
 *
 * ── 保持与站点工具一致的部分（有意兼容）───────────────────────────
 *   规则优先级、正则、以及 asterisk / full / type 三种掩码格式全部保持原样，
 *   保证同一输入在站点工具与本能力下得到相同结果（hash 模式除外，见 F1）。
 *
 * ── 已知局限（不隐藏，写在这里）──────────────────────────────────
 *   [L1] card 规则为宽松的「4-4-4-1~4 位数字」，会把 13–19 位的长数字串
 *        （时间戳、内部 ID）一并识别为卡号。这是原工具的既有行为，保留。
 *   [L2] phone 规则覆盖面很宽（`\+?\d[\d\s()-]{4,18}\d`），可能吞掉不含
 *        电话语义的长数字块。保留，因为收紧会漏掉 "+1 (555) 123-4567" 这类写法。
 *   [L3] zip 的 asterisk 模式对 9 位邮编（12345-6789）只保留末两位，
 *        语义上不严谨，但与原工具一致。
 *   [L4] 基于正则的脱敏**不构成合规级 DLP**。它能防「不小心贴出去」，
 *        不能防「刻意构造的规避」。请勿用于有监管义务的正式流程。
 */

import { createHash } from 'node:crypto';

export const CAPABILITY = Object.freeze({
  id: 'privacy/mask-pii',
  version: '1.0.0',
  sourceTool: 'security-data-masker',
  deterministic: true,
  networkAccess: false,
});

const ALL_TYPES = ['card', 'ssn', 'email', 'ip', 'zip', 'phone'];

/** 规则顺序即安全边界：特征具体的先认，特征松散的后认。 */
const RULES = [
  { type: 'card', re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,4}\b/g },
  { type: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
  { type: 'ip', re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  { type: 'zip', re: /\b\d{5}(?:-\d{4})?\b/g },
  { type: 'phone', re: /(\+?\d[\d\s()-]{4,18}\d)(?!\d)/g },
];

const LABELS = {
  card: '[CREDIT_CARD]',
  ssn: '[SSN]',
  email: '[EMAIL]',
  ip: '[IP]',
  zip: '[ZIP]',
  phone: '[PHONE]',
};

const FULL_MASKS = {
  card: '****-****-****-****',
  ssn: '***-**-****',
  email: '*****@****.***',
  ip: '***.***.***.***',
  zip: '*****',
  phone: '***-***-****',
};

const STYLES = ['asterisk', 'full', 'type', 'hash'];

/** 真 SHA-256，截取 12 位十六进制（48 bit）。原实现是 32 bit 可暴力枚举的弱哈希。 */
function digest(value, salt) {
  return createHash('sha256')
    .update(String(salt ?? '') + '\u0000' + value, 'utf8')
    .digest('hex')
    .slice(0, 12);
}

function maskAsterisk(type, value) {
  switch (type) {
    case 'email': {
      const at = value.lastIndexOf('@');
      const user = value.slice(0, at);
      const domain = value.slice(at + 1);
      const tld = domain.slice(domain.lastIndexOf('.') + 1);
      return (
        user[0] +
        '*'.repeat(Math.max(user.length - 1, 3)) +
        '@' +
        domain[0] +
        '***.' +
        tld
      );
    }
    case 'phone': {
      const digits = value.replace(/\D/g, '');
      return digits.slice(0, 3) + '-***-' + digits.slice(-4);
    }
    case 'card':
      return '****-****-****-' + value.replace(/\D/g, '').slice(-4);
    case 'ssn':
      return '***-**-' + value.slice(-4);
    case 'ip':
      return value.replace(/\d+\.\d+\./, '***.**.');
    case 'zip':
      return '***' + value.slice(-2);
    default:
      return '***';
  }
}

function maskValue(type, value, style, salt) {
  if (style === 'type') return LABELS[type];
  if (style === 'hash') return `[${type.toUpperCase()}:${digest(value, salt)}]`;
  if (style === 'full') return FULL_MASKS[type];
  return maskAsterisk(type, value);
}

/**
 * 扫描并脱敏文本中的 PII。
 *
 * @param {string} text 待处理文本。非字符串入参会被 String() 转换；null/undefined 视为空串。
 * @param {object} [options]
 * @param {string[]} [options.types] 要脱敏的类型，可选 card/ssn/email/ip/zip/phone。默认全部。
 * @param {'asterisk'|'full'|'type'|'hash'} [options.style='asterisk'] 掩码风格。
 * @param {string} [options.salt=''] hash 风格的盐。相同 salt + 相同原文 → 相同掩码（便于统计去重）；
 *                                   不同 salt 之间不可关联。生产环境建议显式传入。
 * @returns {{ output: string, detections: Array<{type:string,value:string,start:number,end:number,replacement:string}> }}
 */
export function maskPII(text, options = {}) {
  const input = text == null ? '' : String(text);
  const style = STYLES.includes(options.style) ? options.style : 'asterisk';
  const requested = Array.isArray(options.types) ? options.types : ALL_TYPES;
  const active = RULES.filter((r) => requested.includes(r.type));
  const salt = options.salt ?? '';

  // 一次性扫描，收集全部候选命中（带原始坐标）
  const candidates = [];
  for (const rule of active) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(input)) !== null) {
      candidates.push({ type: rule.type, value: m[0], start: m.index, end: m.index + m[0].length });
      if (m.index === m[0].length && m[0].length === 0) rule.re.lastIndex += 1;
    }
  }

  // 按起点升序；起点相同则按规则声明顺序（具体优先）。重叠者丢弃。
  const rank = new Map(RULES.map((r, i) => [r.type, i]));
  candidates.sort((a, b) => a.start - b.start || rank.get(a.type) - rank.get(b.type));

  const accepted = [];
  let cursor = -1;
  for (const c of candidates) {
    if (c.start >= cursor) {
      accepted.push(c);
      cursor = c.end;
    }
  }

  // 从后向前替换，避免坐标偏移
  let output = input;
  const detections = [];
  for (let i = accepted.length - 1; i >= 0; i--) {
    const c = accepted[i];
    const replacement = maskValue(c.type, c.value, style, salt);
    output = output.slice(0, c.start) + replacement + output.slice(c.end);
    detections.unshift({ ...c, replacement });
  }

  return { output, detections };
}

/** 仅返回脱敏后的文本（站点工具的等价 API）。 */
export function maskText(text, options = {}) {
  return maskPII(text, options).output;
}
