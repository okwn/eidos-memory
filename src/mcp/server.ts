import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import path from 'path';

import { handleIndexProject } from './tools/index_project.js';
import { handleUpdateFile } from './tools/update_file.js';
import { handleLogConversation } from './tools/log_conversation.js';
import { handleRemember } from './tools/remember.js';
import { handleSearchMemory } from './tools/search_memory.js';
import { handleAssembleContext } from './tools/assemble_context.js';
import { handleGetContextDelta } from './tools/get_context_delta.js';
import { handleCompressText } from './tools/compress_text.js';
import { handlePrefetch } from './tools/prefetch.js';
import { handleGenerateQms } from './tools/generate_qms.js';
import { handleLoadQms } from './tools/load_qms.js';
import { handleFeedback } from './tools/feedback.js';

import { TOOL_DEFINITIONS } from './tool_definitions.js';

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'eidos-memory', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

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
        case 'search_memory':       return await handleSearchMemory(params);
        case 'assemble_context':    return await handleAssembleContext(params);
        case 'get_context_delta':   return await handleGetContextDelta(params);
        case 'compress_text':       return await handleCompressText(params);
        case 'prefetch':            return await handlePrefetch(params);
        case 'generate_qms':        return await handleGenerateQms(params);
        case 'load_qms':            return await handleLoadQms(params);
        case 'feedback':            return await handleFeedback(params);
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

  // Graceful shutdown
  const shutdown = async () => {
    console.error('[eidos-mcp] Shutting down...');
    await server.close().catch(() => {});
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
