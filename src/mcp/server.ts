import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

import { handleIndexProject, indexProject } from './tools/index_project.js';
import { handleUpdateFile } from './tools/update_file.js';
import { handleLogConversation } from './tools/log_conversation.js';
import { handleRemember } from './tools/remember.js';
import { handleSearchMemory } from './tools/search_memory.js';
import { handleAssembleContext, recordReSearchSignal } from './tools/assemble_context.js';
import { handleGetContextDelta } from './tools/get_context_delta.js';
import { handleCompressText } from './tools/compress_text.js';
import { handlePrefetch } from './tools/prefetch.js';
import { handleGenerateQms } from './tools/generate_qms.js';
import { handleLoadQms } from './tools/load_qms.js';
import { handleFeedback } from './tools/feedback.js';
import { handleGetObservation } from './tools/get_observation.js';
import { handleListRecent } from './tools/list_recent.js';

import { TOOL_DEFINITIONS, SYSTEM_PROMPT } from './tool_definitions.js';
import { getDb } from '../store/db.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { version: string };

function loadAutoConfig(): { auto_mode: boolean; auto_index_on_connect: boolean; auto_qms_on_session_end: boolean; auto_assemble_on_prompt: boolean } {
  try {
    const cfgPath = path.join(process.cwd(), 'eidos.config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      return {
        auto_mode: cfg.auto_mode ?? true,
        auto_index_on_connect: cfg.auto_index_on_connect ?? true,
        auto_qms_on_session_end: cfg.auto_qms_on_session_end ?? true,
        auto_assemble_on_prompt: cfg.auto_assemble_on_prompt ?? true,
      };
    }
  } catch { /* ignore */ }
  return { auto_mode: true, auto_index_on_connect: true, auto_qms_on_session_end: true, auto_assemble_on_prompt: true };
}

async function autoIndexIfNeeded(): Promise<void> {
  const config = loadAutoConfig();
  if (!config.auto_mode || !config.auto_index_on_connect) return;

  try {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
    if (count.count === 0) {
      const workspace = process.env.EIDOS_WORKSPACE || process.cwd();
      console.error(`[eidos-mcp] Workspace not indexed. Auto-indexing ${workspace}...`);
      await indexProject({ path: workspace });
      console.error(`[eidos-mcp] Auto-indexed ${workspace}`);
    }
  } catch (err) {
    console.error('[eidos-mcp] Auto-index failed:', err);
  }
}

async function autoLoadQms(): Promise<void> {
  const config = loadAutoConfig();
  if (!config.auto_mode) return;

  try {
    const db = getDb();
    const latestQms = db.prepare(
      "SELECT id FROM nodes WHERE type = 'qms' ORDER BY created_at DESC LIMIT 1"
    ).get() as { id: string } | undefined;
    if (latestQms) {
      await handleLoadQms({ qms_id: latestQms.id });
      console.error('[eidos-mcp] Auto-loaded latest QMS for session continuity');
    }
  } catch (err) {
    console.error('[eidos-mcp] Auto-load QMS failed:', err);
  }
}

async function autoGenerateQms(): Promise<void> {
  const config = loadAutoConfig();
  if (!config.auto_mode || !config.auto_qms_on_session_end) return;

  try {
    await handleGenerateQms({ session_id: `auto-${Date.now()}` });
    console.error('[eidos-mcp] QMS auto-saved for next session');
  } catch (err) {
    console.error('[eidos-mcp] Auto-generate QMS failed:', err);
  }
}

export async function startMcpServer(): Promise<void> {
  const autoApprove = process.env['EIDOS_AUTO_APPROVE'] === '1';
  const server = new Server(
    { name: 'eidos-memory', version: pkg.version },
    { capabilities: { tools: {} }, instructions: SYSTEM_PROMPT },
  );

  // Auto-index and auto-load QMS on connect
  await autoIndexIfNeeded();
  await autoLoadQms();

  if (autoApprove) {
    console.error('[eidos-mcp] Auto-approve enabled — all tool calls will execute without prompt');
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'index_project':       return await handleIndexProject(params);
        case 'update_file':         return await handleUpdateFile(params);
        case 'log_conversation':    return await handleLogConversation(params);
        case 'remember':            return await handleRemember(params);
        case 'search_memory':       { recordReSearchSignal(String(params['session_id'] ?? 'default')); return await handleSearchMemory(params); }
        case 'assemble_context':    return await handleAssembleContext(params);
        case 'get_context_delta':   return await handleGetContextDelta(params);
        case 'compress_text':       return await handleCompressText(params);
        case 'prefetch':            return await handlePrefetch(params);
        case 'generate_qms':        return await handleGenerateQms(params);
        case 'load_qms':            return await handleLoadQms(params);
        case 'feedback':            return await handleFeedback(params);
        case 'get_observation':     return await handleGetObservation(params);
        case 'list_recent':         return await handleListRecent(params);
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[eidos-mcp] Server running on stdio');

  // Graceful shutdown — auto-generate QMS and close DB before exit
  const shutdown = async () => {
    console.error('[eidos-mcp] Shutting down...');
    await autoGenerateQms();
    await server.close().catch(() => {});
    try { const { closeDb } = await import('../store/db.js'); closeDb(); } catch { /* non-critical */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Auto-start when run directly (required for MCP client compatibility)
const __filename = fileURLToPath(import.meta.url).replace(/\\/g, '/');
const entryPath = process.argv[1]?.replace(/"/g, '').replace(/\\/g, '/') ?? '';
if (entryPath && (entryPath === __filename || entryPath.endsWith('/server.js'))) {
  startMcpServer().catch((err) => {
    console.error('[eidos-mcp] Failed to start:', err);
    process.exit(1);
  });
}
