/**
 * media/imaging 测试
 * 三种媒体尺寸/体积能力：宽高比、打印尺寸、音频体积。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertAspectRatio,
  simplifyRatio,
  calcPrintSize,
  estimateAudioFileSize,
  PRINT_SIZES,
  AUDIO_FORMAT_KEYS,
} from '../src/media/imaging.mjs';

test('宽高比：已知宽度求高度', () => {
  assert.equal(convertAspectRatio({ ratio: '16:9', width: 1920 }).height, 1080);
  assert.equal(convertAspectRatio({ ratio: '4:3', width: 1600 }).height, 1200);
});

test('宽高比：已知高度求宽度', () => {
  assert.equal(convertAspectRatio({ ratio: '16:9', height: 1080 }).width, 1920);
});

test('宽高比：预设尺寸与朝向', () => {
  assert.equal(convertAspectRatio({ preset: '4x6' }).orientation, 'portrait');
  assert.equal(convertAspectRatio({ preset: '4x6', orientation: 'landscape' }).ratio.label, '6:4');
  assert.throws(() => convertAspectRatio({ preset: 'nope' }), RangeError);
});

test('比例简化用最大公约数', () => {
  assert.equal(simplifyRatio(1920, 1080), '16:9');
  assert.equal(simplifyRatio(1600, 1200), '4:3');
  assert.equal(simplifyRatio(7, 3), '2.33:1', '互质时应退回小数表示');
});

test('宽高比：非法输入抛错', () => {
  assert.throws(() => convertAspectRatio({}), RangeError);
  assert.throws(() => convertAspectRatio({ ratio: '16' }), RangeError);
  assert.throws(() => convertAspectRatio({ ratio: '16:9', width: 0 }), RangeError);
});

test('打印尺寸：4000×3000 打印 4x6 @300dpi 判定为画质充足', () => {
  const r = calcPrintSize({ photoW: 4000, photoH: 3000, preset: '4x6', dpi: 300 });
  assert.deepEqual(r.requiredPixels, { width: 1200, height: 1800 });
  assert.equal(r.quality.verdict, 'sufficient');
  assert.ok(r.quality.overall >= 1);
});

test('打印尺寸：像素不足时给出 insufficient 与告警', () => {
  const r = calcPrintSize({ photoW: 800, photoH: 600, preset: '16x20', dpi: 300 });
  assert.equal(r.quality.verdict, 'insufficient');
  assert.ok(r.warnings.some((w) => w.includes('像素不足')));
});

test('打印尺寸：宽高比不一致时计算裁切', () => {
  const r = calcPrintSize({ photoW: 4000, photoH: 3000, preset: '8x10', dpi: 300 });
  assert.ok(r.crop, '4:3 打印 8:10 必然需要裁切');
  assert.equal(r.crop.axis, 'sides');
  assert.ok(r.crop.removePercent > 0 && r.crop.removePercent < 100);
});

test('打印尺寸：比例一致时不产生裁切', () => {
  const r = calcPrintSize({ photoW: 3000, photoH: 2000, printW: 6, printH: 4, dpi: 300 });
  assert.equal(r.crop, null);
  assert.equal(r.target.ratio, 1.5);
});

test('打印尺寸：低 DPI 给出告警', () => {
  assert.ok(calcPrintSize({ photoW: 1000, photoH: 1000, preset: '4x6', dpi: 100 }).warnings.some((w) => w.includes('DPI')));
});

test('打印尺寸：非法输入抛错', () => {
  assert.throws(() => calcPrintSize({ photoW: 0, photoH: 100, preset: '4x6' }), RangeError);
  assert.throws(() => calcPrintSize({ photoW: 100, photoH: 100, printW: -1, printH: 5 }), RangeError);
});

test('音频体积：WAV PCM 公式 = 采样率 × 位深/8 × 声道 × 秒数', () => {
  // 44100 × 2 × 2 × 60 = 10,584,000 bytes = 10.09 MB
  const r = estimateAudioFileSize({ durationMinutes: 1, sampleRate: 44100, bitDepth: 16, channels: 2, format: 'wav_pcm' });
  assert.equal(r.sizeBytes, 10584000);
  assert.equal(r.sizeMB, 10.09);
});

test('音频体积：MP3 320 公式 = 码率 × 秒数 / 8', () => {
  // 320000 × 180 / 8 = 7,200,000 bytes = 6.87 MB
  const r = estimateAudioFileSize({ durationMinutes: 3, format: 'mp3_320' });
  assert.equal(r.sizeBytes, 7200000);
  assert.equal(r.sizeMB, 6.87);
});

test('音频体积：有损格式显著小于无损', () => {
  const wav = estimateAudioFileSize({ durationMinutes: 5, format: 'wav_pcm' }).sizeBytes;
  const mp3 = estimateAudioFileSize({ durationMinutes: 5, format: 'mp3_128' }).sizeBytes;
  assert.ok(mp3 < wav / 5);
});

test('音频体积：文件名/字段错误的格式抛错，而不是静默返回 0', () => {
  assert.throws(() => estimateAudioFileSize({ durationMinutes: 1, format: 'mp3_999' }), RangeError);
  assert.throws(() => estimateAudioFileSize({ durationMinutes: 1, format: 'mp3' }), RangeError);
  assert.ok(AUDIO_FORMAT_KEYS.includes('mp3_320'));
});

test('音频体积：非法参数抛错', () => {
  assert.throws(() => estimateAudioFileSize({ durationMinutes: -1 }), RangeError);
  assert.throws(() => estimateAudioFileSize({ durationMinutes: 1, channels: 0 }), RangeError);
  assert.throws(() => estimateAudioFileSize({ durationMinutes: 1, channels: 9 }), RangeError);
});

test('音频体积：0 时长得到 0 字节', () => {
  assert.equal(estimateAudioFileSize({ durationMinutes: 0 }).sizeBytes, 0);
});

test('预设尺寸表完整且数值合法', () => {
  for (const [k, v] of Object.entries(PRINT_SIZES)) {
    assert.ok(v.w > 0 && v.h > 0, `${k} 尺寸非法`);
  }
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(calcPrintSize({ photoW: 4000, photoH: 3000, preset: '8x10' }), calcPrintSize({ photoW: 4000, photoH: 3000, preset: '8x10' }));
  assert.deepEqual(estimateAudioFileSize({ durationMinutes: 2, format: 'flac' }), estimateAudioFileSize({ durationMinutes: 2, format: 'flac' }));
});
