/**
 * 能力层纪律守卫
 * ============================================================
 * 这三条约束靠人记是记不住的，靠代码检查才成立：
 *   1. 确定性 —— 禁止 Math.random()，禁止 Date.now()
 *   2. 零网络 —— 禁止 fetch / XMLHttpRequest / WebSocket
 *   3. 零依赖 —— 除 Node 内置模块（node: 前缀）外，只允许相对路径 import
 *
 * 本文件**扫描源码文本**，而不是检查运行时行为。
 * 运行时的随机性可能只在某些分支出现，采样测不出来；文本扫描则一个都不放过。
 *
 * ⚠️ 本守卫刻意先剥离注释再扫描：
 *   能力模块的注释里大量出现「站点用了 Math.random，我们不用」这类说明，
 *   若不剥离注释，守卫会对着这些说明本身报警 —— 那是守卫太粗，不是代码有问题。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../src/', import.meta.url);
const PKG_ROOT = new URL('../', import.meta.url);
const rel = (u) => path.relative(fileURLToPath(PKG_ROOT), fileURLToPath(u)).replace(/\\/g, '/');

/** 去掉块注释与行注释。宁可漏报（字符串里的 // 被误当注释截断），也不误报。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

async function listModules(dir = SRC) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...(await listModules(full)));
    else if (entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const modules = await listModules();
const sources = new Map();
for (const u of modules) sources.set(rel(u), stripComments(await fs.readFile(u, 'utf8')));
const rawSources = new Map();
for (const u of modules) rawSources.set(rel(u), await fs.readFile(u, 'utf8'));

test('守卫自身有效：确实扫到了全部能力模块，且剥离注释确实生效', () => {
  assert.ok(modules.length >= 20, `扫到的模块太少（${modules.length}），守卫可能扫错了目录`);
  const names = [...sources.keys()];
  assert.ok(names.includes('src/privacy/mask-pii.mjs'));
  assert.ok(names.includes('src/gaming/puzzles.mjs'));
  // 反向对照：注释里确有 "Math.random" 字样，但剥离后必须消失
  const raw = rawSources.get('src/gaming/puzzles.mjs');
  const stripped = sources.get('src/gaming/puzzles.mjs');
  assert.ok(raw.includes('Math.random'), '前置条件：该模块注释里确实提到了 Math.random');
  assert.ok(!stripped.includes('Math.random'), '剥离注释后不应再出现');
});

test('[确定性] 任何能力模块都不得调用 Math.random()', () => {
  const offenders = [...sources].filter(([, src]) => /Math\.random\s*\(/.test(src)).map(([name]) => name);
  assert.deepEqual(offenders, [], `以下模块使用了 Math.random（应改用 lib/prng.mjs 的 seed 机制）：${offenders.join(', ')}`);
});

test('[确定性] 任何能力模块都不得读取系统时钟 Date.now()', () => {
  const offenders = [...sources].filter(([, src]) => /Date\.now\s*\(/.test(src)).map(([name]) => name);
  assert.deepEqual(offenders, [], `以下模块读取了系统时钟（应改为显式 now 参数）：${offenders.join(', ')}`);
});

test('[确定性] Date.parse 与 Date.UTC 是允许的（用于解析传入的时间）', async () => {
  const practice = sources.get('src/religion/practice.mjs');
  assert.ok(practice.includes('Date.parse'), 'practice 模块应使用 Date.parse 解析传入的时间');
  const sched = sources.get('src/time/scheduling.mjs');
  assert.ok(sched.includes('Date.UTC'), 'scheduling 模块应使用 Date.UTC 作为基准');
});

test('[零网络] 任何能力模块都不得发起网络请求', () => {
  const patterns = [/\bfetch\s*\(/, /XMLHttpRequest/, /new\s+WebSocket/, /EventSource/, /sendBeacon/];
  const offenders = [...sources]
    .filter(([, src]) => patterns.some((re) => re.test(src)))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], `以下模块包含网络调用：${offenders.join(', ')}`);
});

test('[零依赖] 除 Node 内置模块外，所有 import 都必须是相对路径', () => {
  const offenders = [];
  for (const [name, src] of sources) {
    const specs = [
      ...[...src.matchAll(/^\s*(?:import|export)\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
      ...[...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ];
    for (const s of specs) {
      if (!s.startsWith('.') && !s.startsWith('node:')) offenders.push(`${name} → ${s}`);
    }
  }
  assert.deepEqual(offenders, [], `发现外部依赖（node: 内置模块是允许的）：${offenders.join(', ')}`);
});

test('[零依赖] 全仓库唯一允许的内置模块是 node:crypto 与 node: 前缀内置模块', async () => {
  const used = new Set();
  for (const [, src] of sources) {
    for (const m of src.matchAll(/from\s+['"](node:[^'"]+)['"]/g)) used.add(m[1]);
  }
  for (const m of used) {
    assert.match(m, /^node:[a-z/]+$/, `内置模块名异常：${m}`);
  }
  // 实际用到的只应是 node:crypto（mask-pii 的强哈希）
  assert.deepEqual([...used].sort(), ['node:crypto']);
});

test('[零依赖] package.json 不声明任何 dependencies', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'package.json 不应声明 dependencies');
  assert.equal(pkg.devDependencies, undefined, 'package.json 不应声明 devDependencies');
});

test('[零依赖] bin 入口只 import 相对路径或内置模块', async () => {
  const src = await fs.readFile(new URL('../bin/mcp-server.mjs', import.meta.url), 'utf8');
  const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) {
    assert.ok(s.startsWith('.') || s.startsWith('node:'), `bin 入口出现外部依赖：${s}`);
  }
});

test('[可审计] 非法输入抛错而非静默返回空', async () => {
  const { computeBMI } = await import('../src/health/bmi.mjs');
  assert.throws(() => computeBMI({}), RangeError);
  const { estimateAudioFileSize } = await import('../src/media/imaging.mjs');
  assert.throws(() => estimateAudioFileSize({ durationMinutes: 1, format: 'nope' }), RangeError);
  const { convertColor } = await import('../src/units/color.mjs');
  assert.throws(() => convertColor('nope'), RangeError);
  const { diffDates } = await import('../src/time/scheduling.mjs');
  assert.throws(() => diffDates('nope', '2026-01-01'), RangeError);
  const { calcAquariumStock } = await import('../src/business/metrics.mjs');
  assert.throws(() => calcAquariumStock({ volume: 0, fishGroups: [{ type: 'tetra', sizeInches: 1, quantity: 1 }] }), RangeError);
});

test('[可复现] 所有生成类能力都给出一致的可复现结果', async () => {
  const { generateLorem } = await import('../src/text/writing.mjs');
  assert.equal(generateLorem({ seed: 'x' }).text, generateLorem({ seed: 'x' }).text);
  const { generatePassword } = await import('../src/security/password.mjs');
  assert.deepEqual(generatePassword({ seed: 'x' }).passwords, generatePassword({ seed: 'x' }).passwords);
  const { generateEscapeRoomPuzzle } = await import('../src/gaming/puzzles.mjs');
  assert.equal(generateEscapeRoomPuzzle({ seed: 'x' }).solution, generateEscapeRoomPuzzle({ seed: 'x' }).solution);
});

test('[可复现] 同一能力连续两次调用结果完全一致（抽查 6 个模块）', async () => {
  const cases = [
    ['../src/finance/loans.mjs', 'calcMortgage', { price: 300000, annualRatePercent: 5.5, years: 15 }],
    ['../src/text/readability.mjs', 'analyzeReadability', 'The quick brown fox jumps over the lazy dog. It was found.'],
    ['../src/media/imaging.mjs', 'calcPrintSize', { photoW: 4000, photoH: 3000, preset: '8x10' }],
    ['../src/weather/comfort.mjs', 'calcApparentTemperature', { temperature: 33, humidityPercent: 70 }],
    ['../src/business/metrics.mjs', 'splitTip', { subtotal: 88.88, tipPercent: 18, people: 3 }],
    ['../src/time/scheduling.mjs', 'estimateHikingTime', { distanceKm: 14.2, elevationGainM: 700 }],
  ];
  for (const [mod, fn, arg] of cases) {
    const m = await import(mod);
    assert.deepEqual(m[fn](arg), m[fn](arg), `${fn} 不确定`);
  }
});
