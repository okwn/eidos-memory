import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { getDb, recordSavings } from '../store/db.js';
import { embed } from '../engine/embedding.js';
import { assembleContext } from '../engine/retrieval.js';
import { countTokens } from '../engine/tokens.js';
import { listNodes } from '../store/nodes.js';
import { handleLogConversation } from '../mcp/tools/log_conversation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Adapter schema (supports both legacy and new format) ────────────────────
interface AdapterInjection {
  method: 'prepend' | 'append' | 'system_message' | 'system_flag';
  format?: string;      // e.g. "<system>{context}</system>\n\n<user>{prompt}</user>"
  flag?: string;        // e.g. "--system-prompt" for system_flag method
}

interface AdapterPromptExtraction {
  source: 'args' | 'stdin_or_args';
  arg_index: number | null;
  stdin_fallback: boolean;
}

interface AdapterConfig {
  name: string;
  detect: string[];
  mode: 'wrap' | 'mcp';
  // New schema
  prompt_extraction?: AdapterPromptExtraction;
  injection?: AdapterInjection;
  interactive_mode?: boolean;
  timeout_ms?: number;
  // Legacy schema
  prompt_arg?: number;
  inject_as?: 'prepend' | 'append';
  system_flag?: string;
}

// ── Safe binary resolution (avoids shell: true / DEP0190) ───────────────────
function resolveBinary(name: string): string {
  if (process.platform === 'win32') return name; // Windows: let shell resolve
  // Unix: use `which` to get the full path, fall back to plain name
  try {
    return execFileSync('which', [name], { encoding: 'utf-8' }).trim() || name;
  } catch {
    return name;
  }
}

function resolveAdaptersDir(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'adapters'),
    path.join(__dirname, 'adapters'),
    path.join(process.cwd(), 'adapters'),
  ];
  return candidates.find(d => fs.existsSync(d)) ?? candidates[0];
}

function loadAdapter(cliName: string): AdapterConfig {
  const dir = resolveAdaptersDir();
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as AdapterConfig;
        if (cfg.detect?.some(d => cliName.includes(d))) return cfg;
      } catch { /* skip */ }
    }
  }
  return { name: cliName, detect: [cliName], mode: 'wrap', prompt_arg: 0, inject_as: 'prepend' };
}

// ── Auto-log both sides of the conversation into memory ──────────────────────
function autoLogTurns(sessionId: string, userPrompt: string, assistantResponse: string): void {
  if (!userPrompt && !assistantResponse) return;
  void Promise.all([
    userPrompt      ? handleLogConversation({ role: 'user',      content: userPrompt,       session_id: sessionId }) : Promise.resolve(),
    assistantResponse ? handleLogConversation({ role: 'assistant', content: assistantResponse, session_id: sessionId }) : Promise.resolve(),
  ]).catch(() => { /* non-critical, never block the user */ });
}

function buildEnrichedPrompt(adapter: AdapterConfig, context: string, originalPrompt: string): string {
  const method = adapter.injection?.method ?? (adapter.inject_as === 'append' ? 'append' : 'prepend');
  if (method === 'system_message' && adapter.injection?.format) {
    return adapter.injection.format
      .replace('{context}', context)
      .replace('{prompt}', originalPrompt);
  }
  if (method === 'append') return `${originalPrompt}\n\n${context}`;
  return `${context}\n\n${originalPrompt}`;
}

export async function wrapCommand(
  cli: string,
  args: string[],
  opts: { query?: string; budget: number },
): Promise<void> {
  const db = getDb();
  const adapter = loadAdapter(cli);
  const isInteractive = adapter.interactive_mode === true;
  const timeoutMs     = adapter.timeout_ms ?? 60000;
  // Stable session ID per process (consistent within one wrap invocation)
  const sessionId = process.env['EIDOS_SESSION_ID'] ?? `wrap:${cli}:${randomUUID().slice(0, 8)}`;

  // ── Resolve the original prompt ──────────────────────────────────────────
  let originalPrompt = '';
  const extraction = adapter.prompt_extraction;
  if (extraction) {
    if (extraction.arg_index !== null && extraction.arg_index !== undefined) {
      originalPrompt = args[extraction.arg_index] ?? '';
    } else if (extraction.source === 'stdin_or_args') {
      // First non-flag arg, stdin read deferred to after context assembly
      originalPrompt = args.find(a => !a.startsWith('-')) ?? '';
    }
  } else {
    // Legacy schema
    const idx = adapter.prompt_arg ?? 0;
    originalPrompt = args[idx] ?? args.find(a => !a.startsWith('-')) ?? '';
  }

  const query = opts.query ?? originalPrompt;

  // --no-memory flag: skip enrichment entirely, just passthrough
  if (process.env['EIDOS_NO_MEMORY'] === '1' || args.includes('--no-memory')) {
    const cleanArgs = args.filter(a => a !== '--no-memory');
    spawnSafe(cli, cleanArgs, 'inherit').on('close', code => process.exit(code ?? 0));
    return;
  }

  if (!query && !isInteractive) {
    spawnSafe(cli, args, 'inherit').on('close', code => process.exit(code ?? 0));
    return;
  }

  // ── Assemble context ─────────────────────────────────────────────────────
  const tokensBefore = countTokens(query);
  let contextString = '';

  try {
    const queryEmbedding = query ? await embed(query) : new Float32Array(384);
    const essentials: Array<{ label: string; content: string }> = [];
    const turns = listNodes(db, 'conversation_turn', 6).slice(-3);
    for (const t of turns) {
      const p = t.properties as Record<string, unknown>;
      essentials.push({ label: String(p['role']), content: String(p['micro_summary'] ?? '') });
    }
    const result = await assembleContext(db, query, queryEmbedding, null, opts.budget, essentials);
    contextString = result.contextString;
    const tokensAfter  = countTokens(contextString) + tokensBefore;
    const tokensSaved  = Math.max(0, tokensAfter - tokensBefore);
    process.env['EIDOS_TOKENS_SAVED']   = String(tokensSaved);
    process.env['EIDOS_SESSION_TOKENS'] = String(tokensAfter);
  } catch (err) {
    console.error(`[eidos] Context assembly failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Interactive mode: pipe enriched prompt via stdin ─────────────────────
  if (isInteractive) {
    const enrichedStdin = contextString
      ? buildEnrichedPrompt(adapter, contextString, originalPrompt)
      : originalPrompt;

    const child = spawnSafe(cli, args, ['pipe', 'inherit', 'inherit']);

    if (enrichedStdin) {
      child.stdin?.write(enrichedStdin, 'utf-8');
      child.stdin?.end();
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      console.error(`[eidos] Timeout after ${timeoutMs}ms — process killed`);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      // Log user turn only (can't capture interactive output)
      if (originalPrompt) autoLogTurns(sessionId, originalPrompt, '');
      onSessionClose(db, code);
    });
    return;
  }

  // ── Non-interactive mode: inject into args, capture stdout for logging ───
  const enrichedArgs = [...args];
  if (contextString) {
    const method = adapter.injection?.method ?? (adapter.inject_as === 'append' ? 'append' : 'prepend');
    if (method === 'system_flag') {
      const flag = adapter.injection?.flag ?? adapter.system_flag ?? '--system-prompt';
      enrichedArgs.unshift(flag, contextString);
    } else {
      const enrichedPrompt = buildEnrichedPrompt(adapter, contextString, originalPrompt);
      const targetIdx = args.findIndex(a => a === originalPrompt);
      if (targetIdx >= 0) enrichedArgs[targetIdx] = enrichedPrompt;
      else enrichedArgs.push(enrichedPrompt);
    }
  }

  // Capture stdout so we can log the assistant response
  const child = spawnSafe(cli, enrichedArgs, ['inherit', 'pipe', 'inherit']);

  let assistantResponse = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    assistantResponse += text;
    process.stdout.write(text); // pass through to terminal
  });

  child.on('close', (code) => {
    // Auto-log user + assistant turns (fire-and-forget)
    autoLogTurns(sessionId, originalPrompt, assistantResponse.trim());
    onSessionClose(db, code);
  });
}

function onSessionClose(db: import('better-sqlite3').Database, code: number | null): void {
  const saved = parseInt(process.env['EIDOS_TOKENS_SAVED'] ?? '0', 10);
  const costPer1k = parseFloat(process.env['EIDOS_MODEL_COST'] ?? '0.015');
  const dollarsSaved = (saved / 1000) * costPer1k;
  if (saved > 0) {
    const GREEN = '\x1b[32m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';
    process.stderr.write(`\n${GREEN}${BOLD}[eidos] saved ~${saved.toLocaleString()} tokens (~$${dollarsSaved.toFixed(4)}) this session.${RESET}\n`);
    // Synchronous UPSERT — must complete before process.exit() is called below
    try { recordSavings(db, saved, dollarsSaved); } catch { /* non-critical */ }
  }
  process.exit(code ?? 0);
}

// Safe spawn: resolves binary path on Unix; uses shell only on Windows (required for .cmd files)
function spawnSafe(
  cli: string,
  args: string[],
  stdio: 'inherit' | ['pipe' | 'inherit', 'pipe' | 'inherit', 'pipe' | 'inherit'],
) {
  if (process.platform === 'win32') {
    return spawn(cli, args, { stdio, shell: true });
  }
  return spawn(resolveBinary(cli), args, { stdio, shell: false });
}

function spawnPassthrough(cli: string, args: string[]) {
  return spawnSafe(cli, args, 'inherit');
}
