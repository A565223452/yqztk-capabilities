/**
 * capability 组：媒体尺寸与体积
 * ============================================================
 * 覆盖来源工具：
 *   - photography-aspect-ratio-calculator  宽高比换算
 *   - photography-photo-print-resizer      打印尺寸 / DPI / 裁切
 *   - audio-file-size-calculator           音频文件体积估算
 *
 * ── 与站点工具实现的差异 ────────────────────────────────────────
 *   [F1] 除零与非法输入改为显式抛错：站点用 `parseInt(x) || 0` 兜底，
 *        输入 0 或空值时进入静默分支，界面不给出任何解释。
 *   [F2] 打印质量用「实际像素 ÷ 所需像素」表达（站点只输出一个倍数但仍按
 *        最小边计算，口径未说明）。本能力同时给出横向与纵向的独立比值。
 *   [F3] 音频体积支持的格式表显式化：站点把 `mp3_320` 这类字符串按
 *        `split('_')[1]` 取码率，格式名拼错就静默落到 0 字节。
 *        本能力改为显式格式表，未知格式抛错。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   打印常用尺寸表、1024 进制换算、裁切百分比算法、各编码格式的体积公式
 *   与原工具一致（WAV = 采样率 × 位深/8 × 声道 × 秒数；有损 = 码率 × 秒数 / 8）。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 音频体积为理论值，不含容器头、标签、编码器开销，与真实文件有 1%~5% 差异。
 *   [L2] 打印质量只按像素密度判断，不涉及纸张、墨水、锐化等实际成像因素。
 */

export const PRINT_SIZES = Object.freeze({
  '4x6': { w: 4, h: 6 },
  '5x7': { w: 5, h: 7 },
  '8x10': { w: 8, h: 10 },
  '8x12': { w: 8, h: 12 },
  '11x14': { w: 11, h: 14 },
  '11x17': { w: 11, h: 17 },
  '13x19': { w: 13, h: 19 },
  '16x20': { w: 16, h: 20 },
  '20x30': { w: 20, h: 30 },
  '24x36': { w: 24, h: 36 },
  wallet: { w: 2.5, h: 3.5 },
  square8: { w: 8, h: 8 },
  square12: { w: 12, h: 12 },
});

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const round = (x, n = 0) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

/**
 * 宽高比换算。
 *
 * @param {object} input
 * @param {string} [input.ratio] 形如 "16:9"；与 preset 二选一
 * @param {string} [input.preset] PRINT_SIZES 的键，如 "4x6"
 * @param {number} [input.width] 已知宽度 → 求高度
 * @returns {object}
 */
export function convertAspectRatio(input = {}) {
  let w;
  let h;

  if (input.preset !== undefined) {
    const p = PRINT_SIZES[String(input.preset)];
    if (!p) throw new RangeError(`未知的预设尺寸：${input.preset}`);
    w = input.orientation === 'landscape' ? p.h : p.w;
    h = input.orientation === 'landscape' ? p.w : p.h;
  } else if (input.ratio !== undefined) {
    const parts = String(input.ratio).split(':');
    if (parts.length !== 2) throw new RangeError(`ratio 必须形如 "16:9"，收到：${input.ratio}`);
    w = parseInt(parts[0], 10);
    h = parseInt(parts[1], 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new RangeError(`ratio 的两侧必须是正整数：${input.ratio}`);
    }
  } else {
    throw new RangeError('必须提供 ratio 或 preset');
  }

  const result = {
    ratio: { w, h, label: `${w}:${h}` },
    simplified: simplifyRatio(w, h),
    decimal: round(w / h, 6),
    orientation: w > h ? 'landscape' : w < h ? 'portrait' : 'square',
  };

  if (input.width !== undefined) {
    const width = Number(input.width);
    if (!Number.isFinite(width) || width <= 0) throw new RangeError('width 必须是大于 0 的数值');
    result.width = width;
    result.height = Math.round((width * h) / w);
  }
  if (input.height !== undefined) {
    const height = Number(input.height);
    if (!Number.isFinite(height) || height <= 0) throw new RangeError('height 必须是大于 0 的数值');
    result.height = height;
    result.width = Math.round((height * w) / h);
  }
  return result;
}

/** 用最大公约数简化比例；无法整除时退回一位小数。 */
export function simplifyRatio(w, h) {
  const g = gcd(Math.round(w), Math.round(h));
  if (g > 1) return `${Math.round(w) / g}:${Math.round(h) / g}`;
  return `${round(w / h, 2)}:1`;
}

/**
 * 打印尺寸与质量评估。
 *
 * @param {object} input
 * @param {number} input.photoW 照片像素宽
 * @param {number} input.photoH 照片像素高
 * @param {string} [input.preset] 打印尺寸预设
 * @param {number} [input.printW] 自定义打印宽度（英寸）
 * @param {number} [input.printH] 自定义打印高度（英寸）
 * @param {number} [input.dpi=300] 目标 DPI
 */
export function calcPrintSize(input = {}) {
  const photoW = Number(input.photoW);
  const photoH = Number(input.photoH);
  if (!Number.isFinite(photoW) || photoW <= 0) throw new RangeError('photoW 必须是大于 0 的数值');
  if (!Number.isFinite(photoH) || photoH <= 0) throw new RangeError('photoH 必须是大于 0 的数值');

  const dpi = input.dpi === undefined ? 300 : Number(input.dpi);
  if (!Number.isFinite(dpi) || dpi <= 0) throw new RangeError('dpi 必须是大于 0 的数值');

  let printW;
  let printH;
  let sizeKey = null;
  if (input.preset !== undefined) {
    const p = PRINT_SIZES[String(input.preset)];
    if (!p) throw new RangeError(`未知的预设尺寸：${input.preset}`);
    printW = p.w;
    printH = p.h;
    sizeKey = String(input.preset);
  } else {
    printW = Number(input.printW);
    printH = Number(input.printH);
    if (!Number.isFinite(printW) || printW <= 0) throw new RangeError('printW 必须是大于 0 的数值');
    if (!Number.isFinite(printH) || printH <= 0) throw new RangeError('printH 必须是大于 0 的数值');
  }

  const requiredW = Math.round(printW * dpi);
  const requiredH = Math.round(printH * dpi);
  const qualityW = round(photoW / requiredW, 2);
  const qualityH = round(photoH / requiredH, 2);
  const quality = Math.min(qualityW, qualityH);

  const photoRatio = photoW / photoH;
  const printRatio = printW / printH;

  let crop = null;
  if (Math.abs(photoRatio - printRatio) > 0.01) {
    // 照片更宽 → 需要裁两侧；照片更高 → 需要裁上下。按「保持画质」的对齐方式计算。
    if (photoRatio > printRatio) {
      const cropW = photoH * printRatio;
      const removePct = ((photoW - cropW) / photoW) * 100;
      crop = {
        axis: 'sides',
        keepPx: Math.round(cropW),
        removePx: Math.round(photoW - cropW),
        removePercent: round(removePct, 1),
      };
    } else {
      const cropH = photoW / printRatio;
      const removePct = ((photoH - cropH) / photoH) * 100;
      crop = {
        axis: 'top-bottom',
        keepPx: Math.round(cropH),
        removePx: Math.round(photoH - cropH),
        removePercent: round(removePct, 1),
      };
    }
  }

  const verdict = quality >= 1 ? 'sufficient' : quality >= 0.75 ? 'acceptable' : 'insufficient';
  const warnings = [];
  if (verdict === 'insufficient') {
    warnings.push(`像素不足：需要 ${requiredW}×${requiredH}，实际 ${photoW}×${photoH}，放大打印会明显发虚`);
  }
  if (dpi < 150) warnings.push('DPI 低于 150，印刷成品可能有可见颗粒');

  return {
    photo: { width: photoW, height: photoH, ratio: round(photoRatio, 3) },
    target: { sizeKey, widthIn: printW, heightIn: printH, ratio: round(printRatio, 3), dpi },
    requiredPixels: { width: requiredW, height: requiredH },
    quality: { overall: quality, horizontal: qualityW, vertical: qualityH, verdict },
    crop,
    warnings,
  };
}

/** 音频格式 → 每秒字节数（或固定码率） */
const AUDIO_FORMATS = Object.freeze({
  wav_pcm: { kind: 'pcm', label: 'WAV (PCM, uncompressed)' },
  wav_compressed: { kind: 'ratio', ratio: 0.6, label: 'WAV (compressed, ~60% of PCM)' },
  mp3_320: { kind: 'bitrate', kbps: 320, label: 'MP3 320 kbps' },
  mp3_256: { kind: 'bitrate', kbps: 256, label: 'MP3 256 kbps' },
  mp3_192: { kind: 'bitrate', kbps: 192, label: 'MP3 192 kbps' },
  mp3_128: { kind: 'bitrate', kbps: 128, label: 'MP3 128 kbps' },
  aac_256: { kind: 'bitrate', kbps: 256, label: 'AAC 256 kbps' },
  aac_128: { kind: 'bitrate', kbps: 128, label: 'AAC 128 kbps' },
  ogg_192: { kind: 'bitrate', kbps: 192, label: 'OGG Vorbis 192 kbps' },
  flac: { kind: 'ratio', ratio: 0.55, label: 'FLAC (lossless, ~55% of PCM)' },
});

export const AUDIO_FORMAT_KEYS = Object.freeze(Object.keys(AUDIO_FORMATS));

/**
 * 音频文件体积估算。
 *
 * @param {object} input
 * @param {number} input.durationMinutes 时长（分钟）
 * @param {number} [input.sampleRate=44100]
 * @param {number} [input.bitDepth=16]
 * @param {number} [input.channels=2]
 * @param {string} [input.format='wav_pcm']
 */
export function estimateAudioFileSize(input = {}) {
  const durationMinutes = Number(input.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) throw new RangeError('durationMinutes 必须是非负数值');

  const sampleRate = input.sampleRate === undefined ? 44100 : Number(input.sampleRate);
  const bitDepth = input.bitDepth === undefined ? 16 : Number(input.bitDepth);
  const channels = input.channels === undefined ? 2 : Number(input.channels);
  const formatKey = input.format === undefined ? 'wav_pcm' : String(input.format);

  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate 必须是正整数');
  if (!Number.isInteger(bitDepth) || bitDepth <= 0) throw new RangeError('bitDepth 必须是正整数');
  if (!Number.isInteger(channels) || channels <= 0 || channels > 8) throw new RangeError('channels 必须是 1~8 的整数');

  const fmt = AUDIO_FORMATS[formatKey];
  if (!fmt) throw new RangeError(`未知的音频格式：${formatKey}（可用：${AUDIO_FORMAT_KEYS.join(', ')}）`);

  const seconds = durationMinutes * 60;
  const pcmBytes = sampleRate * (bitDepth / 8) * channels * seconds;

  let sizeBytes;
  if (fmt.kind === 'pcm') sizeBytes = pcmBytes;
  else if (fmt.kind === 'ratio') sizeBytes = pcmBytes * fmt.ratio;
  else sizeBytes = (fmt.kbps * 1000 * seconds) / 8;

  const warnings = [];
  if (durationMinutes > 24 * 60) warnings.push('时长超过 24 小时，请确认单位是分钟');
  if (fmt.kind === 'pcm' && durationMinutes > 60) warnings.push('未压缩格式体积较大，长音频建议换用有损编码');

  return {
    format: formatKey,
    formatLabel: fmt.label,
    durationMinutes,
    durationSeconds: seconds,
    parameters: { sampleRate, bitDepth, channels },
    pcmBytes: Math.round(pcmBytes),
    sizeBytes: Math.round(sizeBytes),
    sizeKB: round(sizeBytes / 1024, 2),
    sizeMB: round(sizeBytes / 1024 / 1024, 2),
    sizeGB: round(sizeBytes / 1024 / 1024 / 1024, 4),
    warnings,
  };
}
