#!/usr/bin/env node
/**
 * MCP server 的 stdio 入口（薄绑定层）
 * ============================================================
 * 这一层只做三件事：读 stdin 的行、交给纯逻辑处理器、把结果写回 stdout。
 * 任何调试输出都必须走 stderr —— stdout 只能出现 JSON-RPC 消息，
 * 混入一行日志就会让客户端解析失败。
 *
 * 用法：
 *   node bin/mcp-server.mjs            # 以 stdio 方式运行（供 MCP 客户端接入）
 *   node bin/mcp-server.mjs --list     # 打印工具清单后退出（便于自检）
 */
import { createInterface } from 'node:readline';
import { createProtocolHandler, handleLine, SERVER_INFO, TOOLS } from '../src/mcp/server.mjs';

const handler = createProtocolHandler();

if (process.argv.includes('--list') || process.argv.includes('-l')) {
  process.stdout.write(
    JSON.stringify(
      { server: SERVER_INFO, toolCount: TOOLS.length, tools: handler.listTools().map((t) => t.name) },
      null,
      2
    ) + '\n'
  );
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(
    'yqztk-capabilities MCP server (stdio)\n' +
      '  --list    打印工具清单\n' +
      '  --help    显示本帮助\n' +
      '不带参数时从 stdin 读取一行一个的 JSON-RPC 消息，响应写到 stdout。\n'
  );
  process.exit(0);
}

const writeOut = (obj) => {
  if (obj) process.stdout.write(JSON.stringify(obj) + '\n');
};

const rl = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });

rl.on('line', (line) => {
  try {
    writeOut(handleLine(line, handler));
  } catch (err) {
    // 处理器本身崩溃时也必须回一条 JSON-RPC 错误，否则客户端会一直等
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error: ' + (err?.message || String(err)) },
      }) + '\n'
    );
    process.stderr.write('[mcp] internal error: ' + (err?.stack || err) + '\n');
  }
});

rl.on('close', () => process.exit(0));

process.stderr.write(`[mcp] ${SERVER_INFO.name} v${SERVER_INFO.version} ready on stdio (${TOOLS.length} tools)\n`);
