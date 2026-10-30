/**
 * MCP（Model Context Protocol）服务端协议逻辑
 * ============================================================
 * 为什么手写而不用 @modelcontextprotocol/sdk：
 *   1. 能力层的第一条约束是「依赖树为空，可作为依赖被审计」。
 *      引入 SDK 会带来一棵传递依赖树，审计范围立刻失控。
 *   2. MCP 的 stdio 传输本质就是「一行一个 JSON-RPC 2.0 消息」，
 *      需要实现的方法只有 initialize / tools/list / tools/call / ping，
 *      代码量远小于引入依赖后的维护成本。
 *   3. 零依赖意味着使用者不需要 npm install 就能跑起来；
 *      新增一个能力只需在 tools.mjs 里加一条定义。
 *
 * 设计：本文件是**纯逻辑**（没有 stdin/stdout），因此可以在测试里直接调用；
 *       bin/mcp-server.mjs 只负责把 stdin 的行喂进来、把返回值写出去。
 *       这样做的原因是本机 Node 无法 spawn 子进程，端到端测试跑不通，
 *       把协议逻辑做成纯函数才能被真正验证。
 *
 * 协议版本：支持 2025-06-18 / 2025-03-26 / 2024-11-05，回显客户端版本（若它在其内）。
 */

import { TOOLS } from './tools.mjs';

export { TOOLS, TOOL_NAMES } from './tools.mjs';

export const SERVER_INFO = Object.freeze({
  name: 'yqztk-capabilities',
  version: '0.2.0',
  title: 'YuanqiZhiKe Verifiable + Private compute layer',
});

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * 创建一个协议处理器（纯函数，无 IO）。
 * @returns {{handleMessage:(msg:any)=>object|null, listTools:()=>object[]}}
 */
export function createProtocolHandler() {
  const toolMap = new Map(TOOLS.map((t) => [t.name, t]));

  const listTools = () =>
    TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

  /** @returns {object|null} null 表示这是一条通知（不得回复） */
  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return errorResponse(null, JSONRPC.INVALID_REQUEST, 'Request must be a JSON-RPC object');
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    const ok = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
    const fail = (code, message, data) =>
      isNotification ? null : { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };

    if (typeof method !== 'string') {
      return fail(JSONRPC.INVALID_REQUEST, 'Missing "method"');
    }

    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
        return ok({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Deterministic, offline, auditable compute capabilities. All tools run in-process with zero network access. '
            + 'Results are reproducible: identical input always yields identical output. '
            + 'Tools that involve randomness or time require an explicit seed / now argument — that is by design, not an oversight.',
        });
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null; // 通知，不回复

      case 'ping':
        return ok({});

      case 'tools/list':
        return ok({ tools: listTools() });

      case 'tools/call': {
        const name = params?.name;
        if (typeof name !== 'string') {
          return fail(JSONRPC.INVALID_PARAMS, 'tools/call requires a "name"');
        }
        const tool = toolMap.get(name);
        if (!tool) {
          return fail(JSONRPC.INVALID_PARAMS, `Unknown tool: ${name}`);
        }
        const args = params?.arguments ?? {};
        if (args === null || typeof args !== 'object' || Array.isArray(args)) {
          return fail(JSONRPC.INVALID_PARAMS, 'tools/call "arguments" must be an object');
        }
        // 按 inputSchema 校验必填参数。
        // 不能依赖 handler 自己报错：多数计算函数对空输入是「宽容」的（返回空结果而非抛错），
        // 那样模型会收到一个「成功但没数据」的响应，比直接报错更难纠正。
        const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === null);
        if (missing.length) {
          return ok({
            content: [
              {
                type: 'text',
                text:
                  `[InvalidArguments] Missing required argument(s): ${missing.join(', ')}. ` +
                  `Required: ${(tool.inputSchema.required || []).join(', ')}. ` +
                  `Schema: ${JSON.stringify(tool.inputSchema)}`,
              },
            ],
            isError: true,
          });
        }
        try {
          // 工具自身的执行错误按 MCP 规范用 isError 表达，而不是 JSON-RPC error
          const out = tool.handler(args);
          return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          const kind = e instanceof RangeError ? 'RangeError' : e?.name || 'Error';
          return ok({
            content: [{ type: 'text', text: `[${kind}] ${e?.message || String(e)}` }],
            isError: true,
          });
        }
      }

      default:
        return fail(JSONRPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return { handleMessage, listTools };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * 处理一行输入（JSON 字符串），返回要写出的对象（或 null 表示不回复）。
 * 解析错误也必须回复，否则客户端会挂住等待。
 */
export function handleLine(line, handler = createProtocolHandler()) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return null;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return { jsonrpc: '2.0', id: null, error: { code: JSONRPC.PARSE_ERROR, message: 'Parse error: invalid JSON' } };
  }
  return handler.handleMessage(msg);
}
