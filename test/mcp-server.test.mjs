/**
 * MCP server 协议测试
 * 因为本机 Node 无法 spawn 子进程（EBUSY），这里直接测纯逻辑层：
 * 覆盖握手、工具枚举、逐个工具真实调用、以及全部错误分支。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProtocolHandler,
  handleLine,
  TOOLS,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  DEFAULT_PROTOCOL_VERSION,
} from '../src/mcp/server.mjs';

const call = (h, method, params, id = 1) => h.handleMessage({ jsonrpc: '2.0', id, method, params });

test('initialize：回显客户端支持的协议版本', () => {
  const h = createProtocolHandler();
  for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
    const r = call(h, 'initialize', { protocolVersion: v });
    assert.equal(r.result.protocolVersion, v);
  }
  assert.equal(r0().result.serverInfo.name, SERVER_INFO.name);
  function r0() {
    return call(h, 'initialize', { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0] });
  }
});

test('initialize：未知协议版本回落到默认版本（而不是报错断连）', () => {
  const h = createProtocolHandler();
  const r = call(h, 'initialize', { protocolVersion: '1999-01-01' });
  assert.equal(r.result.protocolVersion, DEFAULT_PROTOCOL_VERSION);
});

test('initialize：声明 tools 能力并给出使用说明', () => {
  const h = createProtocolHandler();
  const r = call(h, 'initialize', { protocolVersion: '2024-11-05' });
  assert.equal(r.result.capabilities.tools.listChanged, false);
  assert.ok(r.result.instructions.includes('reproducible'));
});

test('通知类消息一律不回复（返回 null）', () => {
  const h = createProtocolHandler();
  assert.equal(h.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(h.handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }), null);
  assert.equal(h.handleMessage({ jsonrpc: '2.0', method: 'anything' }), null, '无 id 的方法缺失也不得回复');
});

test('ping 返回空结果对象', () => {
  const h = createProtocolHandler();
  assert.deepEqual(call(h, 'ping', {}).result, {});
});

test('tools/list：每个工具有唯一 name、非空 description 与合法 inputSchema', () => {
  const h = createProtocolHandler();
  const { tools } = call(h, 'tools/list', {}).result;
  assert.equal(tools.length, TOOLS.length);
  const names = new Set();
  for (const t of tools) {
    assert.ok(t.name && typeof t.name === 'string');
    assert.ok(!names.has(t.name), `工具名重复：${t.name}`);
    names.add(t.name);
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 60, `${t.name} 的 description 太短，模型难以判断何时调用`);
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(Array.isArray(t.inputSchema.required), `${t.name} 应声明 required`);
  }
});

test('tools/list 不泄漏内部 handler 字段', () => {
  const h = createProtocolHandler();
  const { tools } = call(h, 'tools/list', {}).result;
  for (const t of tools) {
    assert.equal(t.handler, undefined, 'handler 不应出现在对外清单中');
  }
});

test('[端到端] 每个工具都能被真实调用并返回结构化结果', () => {
  const h = createProtocolHandler();
  const samples = {
    mask_pii: { text: 'reach me at a@b.com' },
    assess_password: { password: 'Tr0ub4dor&3' },
    generate_password: {},
    build_amortization_schedule: { principal: 1000, annualRatePercent: 5, months: 12 },
    monthly_payment: { principal: 1000, annualRatePercent: 5, months: 12 },
    calc_mortgage: { price: 400000, annualRatePercent: 6 },
    calc_car_payment: { price: 30000 },
    simulate_loan_payoff: { balance: 20000, annualRatePercent: 6, monthlyPayment: 500 },
    calc_commission_split: { price: 500000, commissionPercent: 5 },
    analyze_readability: { text: 'The cat sat on the mat.' },
    analyze_keyword_density: { text: 'alpha beta alpha' },
    count_social_caption: { text: 'hello #world' },
    generate_lorem: {},
    compute_bmi: { height: 175, weight: 70 },
    estimate_bac: { weight: 70, drinks: 2, biologicalSex: 'male' },
    analyze_body_measurements: { biologicalSex: 'female', heightCm: 165, weightKg: 58, bustCm: 88, waistCm: 66, hipsCm: 94 },
    beaufort_wind_scale: { speed: 30 },
    calc_apparent_temperature: { temperature: 30 },
    diff_dates: { startISO: '2026-01-01', endISO: '2026-02-01' },
    shift_date: { baseISO: '2026-01-31', amount: 1, unit: 'months' },
    format_countdown: { targetISO: '2026-12-31T00:00:00Z', nowISO: '2026-12-01T00:00:00Z' },
    estimate_hiking_time: { distanceKm: 10 },
    calc_reading_time: { text: 'hello world' },
    convert_crochet_hook: { us: 'H' },
    mix_model_paint: { totalDrops: 20 },
    mix_nail_polish: { color1: '#ff0000', color2: '#0000ff' },
    plan_hair_color: { startLevel: 5, targetLevel: 7 },
    convert_color: { input: '#336699' },
    convert_aspect_ratio: { ratio: '16:9' },
    calc_print_size: { photoW: 4000, photoH: 3000, preset: '4x6' },
    estimate_audio_file_size: { durationMinutes: 3 },
    calc_polling_margin: { sampleSize: 1000 },
    calc_meeting_cost: { people: 6, annualSalaryPerPerson: 120000, hours: 1 },
    split_tip: { subtotal: 100 },
    calc_aquarium_stock: { volume: 29, fishGroups: [{ type: 'tetra', sizeInches: 1.5, quantity: 6 }] },
    generate_escape_room_puzzle: {},
    analyze_mana_curve: {},
    schedule_scripture_review: { verses: [{ ref: 'A', text: 'x' }], now: 0 },
  };
  assert.deepEqual(
    Object.keys(samples).sort(),
    TOOLS.map((t) => t.name).sort(),
    '样本表必须覆盖全部工具，否则这条测试形同虚设'
  );
  for (const [name, args] of Object.entries(samples)) {
    const r = call(h, 'tools/call', { name, arguments: args });
    assert.ok(r.result, `${name} 应返回 result`);
    assert.equal(r.result.isError, undefined, `${name} 不应报错：${JSON.stringify(r.result)}`);
    assert.equal(r.result.content[0].type, 'text');
    const parsed = JSON.parse(r.result.content[0].text);
    assert.equal(typeof parsed, 'object');
  }
});

test('tools/call：结果以 JSON 文本返回，且可被解析回对象', () => {
  const h = createProtocolHandler();
  const r = call(h, 'tools/call', { name: 'mask_pii', arguments: { text: 'a@b.com' } });
  const out = JSON.parse(r.result.content[0].text);
  assert.equal(out.output, 'a***@b***.com');
  assert.equal(out.detections.length, 1);
});

test('tools/call：缺参数时用 isError 表达（而不是 JSON-RPC error）', () => {
  const h = createProtocolHandler();
  const r = call(h, 'tools/call', { name: 'mask_pii', arguments: {} });
  assert.equal(r.result.isError, true);
  assert.ok(r.result.content[0].text.length > 0);
  assert.equal(r.error, undefined, '工具执行错误不应升级为协议错误');
});

test('tools/call：非法数值参数被 RangeError 捕获并如实上报', () => {
  const h = createProtocolHandler();
  const r = call(h, 'tools/call', { name: 'compute_bmi', arguments: { height: 0, weight: 70 } });
  assert.equal(r.result.isError, true);
  assert.ok(r.result.content[0].text.includes('RangeError'));
});

test('tools/call：未知工具返回 -32602', () => {
  const h = createProtocolHandler();
  const r = call(h, 'tools/call', { name: 'no_such_tool', arguments: {} });
  assert.equal(r.error.code, -32602);
  assert.ok(r.error.message.includes('Unknown tool'));
});

test('tools/call：缺 name 或 arguments 非对象都返回 -32602', () => {
  const h = createProtocolHandler();
  assert.equal(call(h, 'tools/call', {}).error.code, -32602);
  assert.equal(call(h, 'tools/call', { name: 'ping', arguments: [] }).error.code, -32602);
});

test('未知方法返回 -32601', () => {
  const h = createProtocolHandler();
  assert.equal(call(h, 'resources/list', {}).error.code, -32601);
});

test('非法请求对象返回 -32600', () => {
  const h = createProtocolHandler();
  assert.equal(h.handleMessage(null).error.code, -32600);
  assert.equal(h.handleMessage([]).error.code, -32600);
  assert.equal(h.handleMessage({ id: 1 }).error.code, -32600);
});

test('handleLine：非法 JSON 返回 -32700，空行不回复', () => {
  const h = createProtocolHandler();
  assert.equal(handleLine('{not json', h).error.code, -32700);
  assert.equal(handleLine('', h), null);
  assert.equal(handleLine('   ', h), null);
});

test('handleLine：合法 JSON 走完整流程', () => {
  const h = createProtocolHandler();
  const r = handleLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }), h);
  assert.equal(r.id, 7);
  assert.deepEqual(r.result, {});
});

test('响应 id 与请求 id 一致（含字符串 id 与 id 0）', () => {
  const h = createProtocolHandler();
  assert.equal(call(h, 'ping', {}, 'abc').id, 'abc');
  assert.equal(call(h, 'ping', {}, 0).id, 0);
});

test('零依赖：MCP 模块只 import 本仓库内的相对路径', async () => {
  const fs = await import('node:fs/promises');
  for (const rel of ['../src/mcp/server.mjs', '../src/mcp/tools.mjs']) {
    const src = await fs.readFile(new URL(rel, import.meta.url), 'utf8');
    const imports = [...src.matchAll(/^\s*(?:import|export)\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.ok(imports.length > 0, `${rel} 应有导入`);
    for (const spec of imports) {
      assert.ok(spec.startsWith('.'), `${rel} 禁止第三方依赖：${spec}`);
    }
  }
});

test('工具定义里没有把随机源或系统时钟藏起来（静态检查调用而非提及）', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/mcp/tools.mjs', import.meta.url), 'utf8');
  // 只检查真正的调用形式，description 里提及这些名字是允许的（本来就是解释为什么不用它们）
  assert.ok(!/Math\.random\s*\(/.test(src), 'tools.mjs 不得调用 Math.random');
  assert.ok(!/Date\.now\s*\(/.test(src), 'tools.mjs 不得读取系统时钟');
});

test('确定性：同一 tools/call 两次返回完全相同的文本', () => {
  const h = createProtocolHandler();
  const run = () => call(h, 'tools/call', { name: 'build_amortization_schedule', arguments: { principal: 2000, annualRatePercent: 3.5, months: 24 } }).result.content[0].text;
  assert.equal(run(), run());
});

test('bin 入口存在且只向 stdout 写 JSON-RPC（静态检查）', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../bin/mcp-server.mjs', import.meta.url), 'utf8');
  // 允许 --list / --help 分支出现 console 之外的输出，但真正的消息通道必须走 JSON.stringify
  assert.ok(src.includes('JSON.stringify(obj)') || src.includes('JSON.stringify('));
  assert.ok(!/console\.log\(/.test(src.replace(/--list[\s\S]*?process\.exit\(0\)/, '')), 'stdio 模式下不得用 console.log 干扰 stdout');
});
