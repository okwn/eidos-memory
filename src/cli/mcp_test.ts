import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GREEN  = '\x1b[32m'; const RED   = '\x1b[31m'; const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m'; const BOLD  = '\x1b[1m';  const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── Spawn MCP server and do JSON-RPC over stdio ───────────────────────────────
function spawnServer(): { proc: ReturnType<typeof spawn>; send: (req: JsonRpcRequest) => void; onLine: (cb: (line: string) => void) => void } {
  const serverPath = path.join(__dirname, '../../dist/mcp/server.js');
  const proc = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: false,
  });

  const listeners: Array<(line: string) => void> = [];
  let buf = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) listeners.forEach(cb => cb(line));
    }
  });

  return {
    proc,
    send(req: JsonRpcRequest) {
      proc.stdin?.write(JSON.stringify(req) + '\n');
    },
    onLine(cb: (line: string) => void) {
      listeners.push(cb);
    },
  };
}

async function sendRequest(
  server: ReturnType<typeof spawnServer>,
  req: JsonRpcRequest,
  timeoutMs = 5000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for id=${req.id}`)), timeoutMs);
    server.onLine(line => {
      try {
        const res = JSON.parse(line) as JsonRpcResponse;
        if (res.id === req.id) {
          clearTimeout(timer);
          resolve(res);
        }
      } catch { /* not JSON, skip */ }
    });
    server.send(req);
  });
}

export interface McpTestOptions {
  tool?: string;
  args?: string;
  all?: boolean;
}

export async function runMcpTest(opts: McpTestOptions): Promise<void> {
  console.log(`\n${BOLD}${CYAN}⚡ EidosCore MCP Test Harness${RESET}\n`);

  const server = spawnServer();
  let passed = 0, failed = 0;

  const check = (label: string, ok: boolean, detail = '') => {
    const icon = ok ? `${GREEN}✔${RESET}` : `${RED}✖${RESET}`;
    console.log(`  ${icon} ${BOLD}${label.padEnd(30)}${RESET}  ${DIM}${detail}${RESET}`);
    if (ok) passed++; else failed++;
  };

  try {
    // 1. initialize
    const initResp = await sendRequest(server, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'eidos-mcp-test', version: '0.1.0' },
      },
    });
    check('initialize', !initResp.error, JSON.stringify(initResp.result ?? initResp.error));

    // 2. tools/list
    const listResp = await sendRequest(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (listResp.result as { tools: Array<{ name: string }> })?.tools ?? [];
    check('tools/list', tools.length > 0, `${tools.length} tools registered`);
    if (tools.length > 0) {
      console.log(`\n  ${DIM}Available tools: ${tools.map(t => t.name).join(', ')}${RESET}\n`);
    }

    if (opts.all) {
      // 3. Test all tools with minimal/safe args
      const safeTests: Array<{ tool: string; args: Record<string, unknown> }> = [
        { tool: 'search_memory',    args: { query: 'test', k: 3 } },
        { tool: 'assemble_context', args: { query: 'test', budget: 500 } },
        { tool: 'compress_text',    args: { text: 'hello world hello world', target_tokens: 5 } },
        { tool: 'remember',         args: { content: 'test note', type: 'decision' } },
        { tool: 'prefetch',         args: { session_id: 'test-session' } },
        { tool: 'log_conversation', args: { session_id: 'test-mcp', role: 'user', content: 'hello' } },
      ];
      for (let i = 0; i < safeTests.length; i++) {
        const t = safeTests[i];
        const resp = await sendRequest(server, {
          jsonrpc: '2.0', id: 10 + i, method: 'tools/call',
          params: { name: t.tool, arguments: t.args },
        }, 10000);
        const ok = !resp.error && !(resp.result as Record<string, unknown>)?.['isError'];
        check(`tool: ${t.tool}`, ok,
          ok ? 'ok' : JSON.stringify(resp.error ?? (resp.result as Record<string, unknown>)?.['content']));
      }
    } else if (opts.tool) {
      // Single tool test
      let toolArgs: Record<string, unknown> = {};
      if (opts.args) {
        try { toolArgs = JSON.parse(opts.args) as Record<string, unknown>; }
        catch { console.error(`${RED}Invalid JSON for --args: ${opts.args}${RESET}`); }
      }
      const resp = await sendRequest(server, {
        jsonrpc: '2.0', id: 20, method: 'tools/call',
        params: { name: opts.tool, arguments: toolArgs },
      }, 15000);
      const ok = !resp.error && !(resp.result as Record<string, unknown>)?.['isError'];
      check(`tool: ${opts.tool}`, ok, JSON.stringify(resp.result ?? resp.error, null, 2));
    }

  } catch (err) {
    console.error(`${RED}${BOLD}Fatal: ${err instanceof Error ? err.message : String(err)}${RESET}`);
    failed++;
  } finally {
    server.proc.kill('SIGTERM');
  }

  console.log('');
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}  ✔ All ${passed} MCP checks passed.${RESET}\n`);
  } else {
    console.log(`${YELLOW}${BOLD}  ${passed} passed, ${RED}${failed} failed${RESET}\n`);
    process.exitCode = 1;
  }
}
