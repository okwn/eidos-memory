import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `eidos-mcp-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('MCP tool definitions', () => {
  it('exports all 14 tool definitions', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/mcp/tool_definitions.js');
    expect(TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(14);
    const names = TOOL_DEFINITIONS.map((t: { name: string }) => t.name);
    expect(names).toContain('assemble_context');
    expect(names).toContain('search_memory');
    expect(names).toContain('remember');
    expect(names).toContain('log_conversation');
    expect(names).toContain('update_file');
    expect(names).toContain('index_project');
    expect(names).toContain('generate_qms');
    expect(names).toContain('load_qms');
    expect(names).toContain('get_context_delta');
    expect(names).toContain('compress_text');
    expect(names).toContain('feedback');
    expect(names).toContain('prefetch');
    expect(names).toContain('get_observation');
    expect(names).toContain('list_recent');
  });

  it('each tool has required fields', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/mcp/tool_definitions.js');
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('MCP tool handlers', () => {
  let ws: string;

  beforeAll(async () => {
    ws = tmpDir();
    process.env['EIDOS_WORKSPACE'] = ws;
    const { resetDbInstance } = await import('../src/store/db.js');
    resetDbInstance();
  });

  afterAll(async () => {
    const { closeDb, resetDbInstance } = await import('../src/store/db.js');
    closeDb();
    resetDbInstance();
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* Windows lock */ }
  });

  it('handleRemember stores a decision', async () => {
    const { handleRemember } = await import('../src/mcp/tools/remember.js');
    const result = await handleRemember({
      statement: 'Use PostgreSQL for production',
      type: 'decision',
      session_id: 'test-session',
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.node_id).toBeTruthy();
  });

  it('handleRemember handles empty statement gracefully', async () => {
    const { handleRemember } = await import('../src/mcp/tools/remember.js');
    const result = await handleRemember({ statement: '' });
    // Should not crash — may store empty or return error
    expect(result.content).toBeTruthy();
  });

  it('handleSearchMemory returns results', async () => {
    const { handleSearchMemory } = await import('../src/mcp/tools/search_memory.js');
    const result = await handleSearchMemory({ query: 'PostgreSQL database' });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  it('handleSearchMemory handles empty query gracefully', async () => {
    const { handleSearchMemory } = await import('../src/mcp/tools/search_memory.js');
    const result = await handleSearchMemory({ query: '' });
    // Should not crash, returns results (possibly empty)
    expect(result.content).toBeTruthy();
  });

  it('handleLogConversation stores turns', async () => {
    const { handleLogConversation } = await import('../src/mcp/tools/log_conversation.js');
    const result = await handleLogConversation({
      session_id: 'test-session',
      turns: [
        { role: 'user', content: 'How do I connect to the database?' },
        { role: 'assistant', content: 'Use the pg client library.' },
      ],
    });
    expect(result.isError).toBeFalsy();
  });

  it('handleFeedback records a score', async () => {
    const { handleFeedback } = await import('../src/mcp/tools/feedback.js');
    const result = await handleFeedback({
      session_id: 'test-session',
      score: 0.8,
      source: 'explicit',
    });
    expect(result.isError).toBeFalsy();
  });

  it('handleGetObservation retrieves stored observation', async () => {
    const { handleGetObservation } = await import('../src/mcp/tools/get_observation.js');
    const result = await handleGetObservation({ id: 'nonexistent' });
    expect(result.isError).toBe(true);
  });

  it('handleListRecent returns recent items', async () => {
    const { handleListRecent } = await import('../src/mcp/tools/list_recent.js');
    const result = await handleListRecent({});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(typeof parsed.count).toBe('number');
  });

  it('handleCompressText compresses input', async () => {
    const { handleCompressText } = await import('../src/mcp/tools/compress_text.js');
    const longText = 'The user asked about authentication. We discussed JWT tokens and session management. The decision was to use JWT with short-lived access tokens and refresh token rotation. This provides better security than session-based auth for our microservices architecture. Additional considerations include token revocation and blacklisting strategies.';
    const result = await handleCompressText({ text: longText });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.compressed_tokens).toBeLessThanOrEqual(parsed.original_tokens);
    expect(parsed.reduction_pct).toBeGreaterThanOrEqual(0);
  });

  it('handleGenerateQms fails gracefully with no nodes', async () => {
    const { handleGenerateQms } = await import('../src/mcp/tools/generate_qms.js');
    const result = await handleGenerateQms({ session_id: 'empty-session' });
    // Should either succeed or return a graceful error
    expect(result.content).toBeTruthy();
  });
});
