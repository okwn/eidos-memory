/**
 * Hook File Writers — Generate JSON hook configs for hook-based CLI/IDE integrations.
 *
 * Each writer generates hook files that call `eidos hook <platform> <event>`.
 * This is the non-MCP integration path used by Gemini CLI, Cursor, and Windsurf.
 *
 * IMPORTANT: Existing user hooks are preserved. Eidos hooks are prepended to
 * existing arrays so they run first, but user hooks are never overwritten.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface HookResult {
  platform: string;
  installed: boolean;
  configPath: string;
  message: string;
}

const EIDOS_BIN = process.platform === 'win32' ? 'eidos.cmd' : 'eidos';

function readJson(p: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function writeJson(p: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/**
 * Merge hook arrays safely: prepend Eidos hooks to any existing user hooks.
 * This ensures Eidos runs first, but user hooks are never overwritten.
 */
function prependHooks(
  existing: Record<string, unknown>,
  eidosHooks: Record<string, Array<Record<string, unknown>>>,
  path: string[] = [],
): Record<string, unknown> {
  const result = { ...existing };

  for (const [key, eidosEntries] of Object.entries(eidosHooks)) {
    const existingValue = existing[key];
    if (Array.isArray(existingValue)) {
      // Prepend Eidos entries to the existing array
      result[key] = [...eidosEntries, ...existingValue];
    } else if (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)) {
      // Recurse into nested objects (e.g. existing.hooks.BeforeAgent)
      result[key] = prependHooks(
        existingValue as Record<string, unknown>,
        { [key]: eidosEntries } as Record<string, unknown> as Record<string, Array<Record<string, unknown>>>,
        [...path, key],
      ) as Record<string, unknown>;
    } else {
      // No existing value — just set the Eidos entries
      result[key] = eidosEntries;
    }
  }

  return result;
}

/**
 * Deep merge for non-array objects (MCP configs, server blocks).
 * For hook arrays, use prependHooks instead.
 */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object' && !Array.isArray(result[k])) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── Individual Hook Writers ────────────────────────────────────────────────

/**
 * Write Gemini CLI hooks to ~/.gemini/settings.json.
 *
 * Gemini stores hooks under `hooks.BeforeAgent`, `hooks.AfterAgent`, etc.
 * User's existing hooks at these keys are preserved — Eidos entries are prepended.
 */
export function writeGeminiHooks(): HookResult {
  const home = os.homedir();
  const geminiDir = path.join(home, '.gemini');
  const settingsPath = path.join(geminiDir, 'settings.json');
  fs.mkdirSync(geminiDir, { recursive: true });

  const existing = readJson(settingsPath);

  // Merge MCP server config (deep merge — no arrays here)
  const existingMcp = (existing['mcpServers'] ?? {}) as Record<string, unknown>;
  existing['mcpServers'] = deepMerge(existingMcp, {
    'eidos-memory': { command: EIDOS_BIN, args: ['mcp'] },
  });

  // Safely merge hook arrays — prepend Eidos, preserve user hooks
  const existingHooks = (existing['hooks'] ?? {}) as Record<string, unknown>;
  const eidosHooks: Record<string, Array<Record<string, unknown>>> = {
    BeforeAgent: [{ command: EIDOS_BIN, args: ['hook', 'gemini', 'context'], timeout: 5000 }],
    AfterAgent: [{ command: EIDOS_BIN, args: ['hook', 'gemini', 'observation'], timeout: 5000 }],
    OnSessionEnd: [{ command: EIDOS_BIN, args: ['hook', 'gemini', 'summarize'], timeout: 15000 }],
  };
  existing['hooks'] = prependHooks(existingHooks, eidosHooks);

  writeJson(settingsPath, existing);

  // Write GEMINI.md context file (only if missing)
  const geminiMd = path.join(geminiDir, 'GEMINI.md');
  if (!fs.existsSync(geminiMd)) {
    fs.writeFileSync(geminiMd, `# Eidos Memory

You have access to Eidos Memory — a knowledge graph of this project.

## Rules
- Call \`assemble_context\` FIRST before any code question
- Use \`search_memory\` for semantic code search (faster than grep)
- After every response, call \`log_conversation\` to save to memory
- Use \`remember\` to save decisions and facts
`);
  }

  return { platform: 'gemini', installed: true, configPath: settingsPath, message: 'Gemini CLI hooks configured' };
}

/**
 * Write Cursor hooks to ~/.cursor/hooks.json.
 *
 * Cursor stores hooks as top-level arrays: `beforeSubmitPrompt`, `afterResponse`, `stop`.
 */
export function writeCursorHooks(): HookResult {
  const home = os.homedir();
  const cursorDir = path.join(home, '.cursor');
  const hooksPath = path.join(cursorDir, 'hooks.json');
  fs.mkdirSync(cursorDir, { recursive: true });

  const existing = readJson(hooksPath);

  // Safely merge hook arrays — prepend Eidos, preserve user hooks
  const eidosHooks: Record<string, Array<Record<string, unknown>>> = {
    beforeSubmitPrompt: [{ command: EIDOS_BIN, args: ['hook', 'cursor', 'context'], timeout: 5000 }],
    afterResponse: [{ command: EIDOS_BIN, args: ['hook', 'cursor', 'observation'], timeout: 5000 }],
    stop: [{ command: EIDOS_BIN, args: ['hook', 'cursor', 'summarize'], timeout: 15000 }],
  };
  const merged = prependHooks(existing, eidosHooks);
  writeJson(hooksPath, merged);

  // Merge MCP config (deep merge — no arrays)
  const mcpPath = path.join(cursorDir, 'mcp.json');
  const mcpExisting = readJson(mcpPath);
  const mcpMerged = deepMerge(mcpExisting, {
    servers: { 'eidos-memory': { type: 'stdio', command: EIDOS_BIN, args: ['mcp'] } },
  });
  writeJson(mcpPath, mcpMerged);

  // Add cursor rules (only if missing)
  const rulesDir = path.join(cursorDir, 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  const rulesPath = path.join(rulesDir, 'eidos-memory-context.mdc');
  if (!fs.existsSync(rulesPath)) {
    fs.writeFileSync(rulesPath, `---
description: Eidos Memory context injection
globs: **/*
---

You have access to Eidos Memory — a knowledge graph of this project.

Rules:
- Call assemble_context FIRST before any code question
- Use search_memory for semantic code search (faster than grep)
- After every response, call log_conversation to save to memory
- Use remember to save decisions and facts
`);
  }

  return { platform: 'cursor', installed: true, configPath: hooksPath, message: 'Cursor hooks configured' };
}

/**
 * Write Windsurf hooks to ~/.codeium/windsurf/hooks.json.
 *
 * Windsurf stores hooks as top-level arrays: `pre_user_prompt`, `post_cascade_response`, etc.
 */
export function writeWindsurfHooks(): HookResult {
  const home = os.homedir();
  const windsurfDir = path.join(home, '.codeium', 'windsurf');
  const hooksPath = path.join(windsurfDir, 'hooks.json');
  fs.mkdirSync(windsurfDir, { recursive: true });

  const existing = readJson(hooksPath);

  // Safely merge hook arrays — prepend Eidos, preserve user hooks
  const eidosHooks: Record<string, Array<Record<string, unknown>>> = {
    pre_user_prompt: [{ command: EIDOS_BIN, args: ['hook', 'windsurf', 'context'], timeout: 5000 }],
    post_cascade_response: [{ command: EIDOS_BIN, args: ['hook', 'windsurf', 'observation'], timeout: 5000 }],
    post_write_code: [{ command: EIDOS_BIN, args: ['hook', 'windsurf', 'observation'], timeout: 5000 }],
    on_session_end: [{ command: EIDOS_BIN, args: ['hook', 'windsurf', 'summarize'], timeout: 15000 }],
  };
  const merged = prependHooks(existing, eidosHooks);
  writeJson(hooksPath, merged);

  // Add windsurf rules (only if missing)
  const rulesDir = path.join(windsurfDir, 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  const rulesPath = path.join(rulesDir, 'eidos-memory-context.md');
  if (!fs.existsSync(rulesPath)) {
    fs.writeFileSync(rulesPath, `# Eidos Memory

You have access to Eidos Memory — a knowledge graph of this project.

## Rules
- Call assemble_context FIRST before any code question
- Use search_memory for semantic code search (faster than grep)
- After every response, call log_conversation to save to memory
- Use remember to save decisions and facts
`);
  }

  return { platform: 'windsurf', installed: true, configPath: hooksPath, message: 'Windsurf hooks configured' };
}

/**
 * Detect and install hooks for all supported platforms.
 * Called by `eidos connect`.
 */
export function installAllHooks(): HookResult[] {
  const results: HookResult[] = [];
  const home = os.homedir();

  if (fs.existsSync(path.join(home, '.gemini'))) {
    try { results.push(writeGeminiHooks()); } catch { /* skip */ }
  }
  if (fs.existsSync(path.join(home, '.cursor'))) {
    try { results.push(writeCursorHooks()); } catch { /* skip */ }
  }
  if (fs.existsSync(path.join(home, '.codeium', 'windsurf'))) {
    try { results.push(writeWindsurfHooks()); } catch { /* skip */ }
  }

  return results;
}