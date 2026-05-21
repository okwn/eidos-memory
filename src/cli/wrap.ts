import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { getDb, recordSavings, getEidosDir, getProjectRoot, getDbPath } from '../store/db.js';
import { embed } from '../engine/embedding.js';
import { assembleContext } from '../engine/retrieval.js';
import { countTokens } from '../engine/tokens.js';
import { handleLogConversation } from '../mcp/tools/log_conversation.js';
import { recordImplicitFeedback } from '../mcp/tools/feedback.js';
import { buildEssentialsFromTurns } from '../engine/essentials.js';

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

// ── Context window bar ─────────────────────────────────────────────────────
function renderTokenBar(used: number, budget: number): string {
  if (budget <= 0) return '';
  const pct = Math.min(1, used / budget);
  const width = 30;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const GREEN = '\x1b[32m'; const YELLOW = '\x1b[33m'; const RED = '\x1b[31m';
  const DIM = '\x1b[2m'; const RESET = '\x1b[0m';
  const colour = pct < 0.6 ? GREEN : pct < 0.85 ? YELLOW : RED;
  const bar = colour + '█'.repeat(filled) + DIM + '░'.repeat(empty) + RESET;
  return `${DIM}[${bar}] ${used}/${budget} tokens${RESET}`;
}

// ── Auto-init: index on first use if no DB exists ──────────────────────────
function autoInitIfNeeded(): void {
  const eidosDir = getEidosDir();
  const dbPath = path.join(eidosDir, 'memory.db');
  if (!fs.existsSync(dbPath)) {
    const projectRoot = getProjectRoot();
    console.error(`\x1b[36m[eidos] First time in this project. Indexing ${projectRoot} in background...\x1b[0m`);
    const eidosBin = process.argv[1] ?? 'eidos';
    const child = spawn(process.execPath, [eidosBin, 'index', projectRoot, '-q'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, EIDOS_WORKSPACE: projectRoot },
    });
    child.unref();
  }
}

export async function wrapCommand(
  cli: string,
  args: string[],
  opts: { query?: string; budget: number },
): Promise<void> {
  autoInitIfNeeded();
  const db = getDb();
  const adapter = loadAdapter(cli);
  const isInteractive = adapter.interactive_mode === true;
  const timeoutMs     = adapter.timeout_ms ?? 60000;
  process.env['EIDOS_BUDGET'] = String(opts.budget);
  // Stable session ID per process (consistent within one wrap invocation)
  const sessionId = process.env['EIDOS_SESSION_ID'] ?? `wrap:${cli}:${randomUUID().slice(0, 8)}`;

  // Handle --yes flag: enable auto-approve for non-interactive memory storage
  if (args.includes('--yes')) {
    process.env['EIDOS_AUTO_APPROVE'] = '1';
    args = args.filter(a => a !== '--yes');
  }

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

  // No prompt: try reading from stdin (pipe mode)
  let stdinPrompt = '';
  if (!query && !process.stdin.isTTY) {
    stdinPrompt = await readStdin();
  }

  const finalPrompt = query || stdinPrompt;

  // No prompt at all: pass through directly (let interactive CLIs open on their own)
  if (!finalPrompt) {
    const DIM = '\x1b[2m'; const CYAN = '\x1b[36m'; const RESET = '\x1b[0m';
    process.stderr.write(`${DIM}${CYAN}[eidos] memory active — ${getDbPath().includes('.eidos') ? 'project indexed' : 'ready'}${RESET}\n`);
    spawnSafe(cli, args, 'inherit').on('close', code => process.exit(code ?? 0));
    return;
  }

  // ── Assemble context ─────────────────────────────────────────────────────
  const effectiveQuery = finalPrompt;
  const tokensBefore = countTokens(effectiveQuery);
  let contextString = '';

  try {
    const queryEmbedding = effectiveQuery ? await embed(effectiveQuery) : new Float32Array(384);
    const essentials = buildEssentialsFromTurns(db);
    const result = await assembleContext(db, effectiveQuery, queryEmbedding, null, opts.budget, essentials);
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
      ? buildEnrichedPrompt(adapter, contextString, finalPrompt)
      : finalPrompt;

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
      if (finalPrompt) autoLogTurns(sessionId, finalPrompt, '');
      onSessionClose(db, code);
    });
    return;
  }

  // ── Non-interactive mode: inject into args, capture stdout for logging ───
  const enrichedArgs = [...args];
  // Detect Claude print mode: if -p or --print is present, use --system-prompt for context
  const isPrintMode = args.includes('-p') || args.includes('--print');
  if (contextString) {
    const method = adapter.injection?.method ?? (adapter.inject_as === 'append' ? 'append' : 'prepend');
    if (method === 'system_flag' || (isPrintMode && adapter.name.includes('claude'))) {
      const flag = adapter.injection?.flag ?? adapter.system_flag ?? '--system-prompt';
      // Insert --system-prompt <context> before the first flag
      const flagIdx = enrichedArgs.findIndex(a => a === '-p' || a === '--print' || a.startsWith('-'));
      if (flagIdx >= 0) {
        enrichedArgs.splice(flagIdx, 0, flag, contextString);
      } else {
        enrichedArgs.unshift(flag, contextString);
      }
    } else {
      const enrichedPrompt = buildEnrichedPrompt(adapter, contextString, finalPrompt);
      const targetIdx = args.findIndex(a => a === finalPrompt || a === originalPrompt);
      if (targetIdx >= 0 && finalPrompt) enrichedArgs[targetIdx] = enrichedPrompt;
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
    autoLogTurns(sessionId, finalPrompt, assistantResponse.trim());
    // Calculate context precision from AI response
    if (assistantResponse && contextString) {
      try {
        const { calculatePrecision } = require('../mcp/tools/assemble_context.js') as typeof import('../mcp/tools/assemble_context.js');
        const prec = calculatePrecision(sessionId, assistantResponse);
        process.env['EIDOS_PRECISION'] = String(prec);
        if (prec > 0) {
          recordImplicitFeedback(sessionId, prec > 50 ? 4 : 3, 'implicit_precision');
        }
      } catch { /* non-critical */ }
    }
    onSessionClose(db, code);
  });
}

function onSessionClose(db: import('better-sqlite3').Database, code: number | null): void {
  const saved = parseInt(process.env['EIDOS_TOKENS_SAVED'] ?? '0', 10);
  const sessionTokens = parseInt(process.env['EIDOS_SESSION_TOKENS'] ?? '0', 10);
  const precision = parseInt(process.env['EIDOS_PRECISION'] ?? '0', 10);
  const costPer1k = parseFloat(process.env['EIDOS_MODEL_COST'] ?? '0.015');
  const dollarsSaved = (saved / 1000) * costPer1k;
  const budget = parseInt(process.env['EIDOS_BUDGET'] ?? '2000', 10);
  if (sessionTokens > 0) {
    process.stderr.write(`\n${renderTokenBar(sessionTokens, budget)}\n`);
  }
  if (saved > 0) {
    const GREEN = '\x1b[32m'; const BOLD = '\x1b[1m'; const DIM = '\x1b[2m'; const RESET = '\x1b[0m';
    const precisionStr = precision > 0 ? ` ${DIM}(${precision}% precise)${RESET}` : '';
    process.stderr.write(`${GREEN}${BOLD}[eidos]${RESET} injected ${sessionTokens} tokens${precisionStr}, saved ~${saved.toLocaleString()} tokens (~$${dollarsSaved.toFixed(4)})${RESET}\n`);
    try { recordSavings(db, saved, dollarsSaved); } catch { /* non-critical */ }
  }
  process.exit(code ?? 0);
}

// Safe spawn: resolves binary path on Unix; on Windows uses cmd /c for .cmd/.bat files
// without shell: true for arguments (prevents DEP0190 and command injection).
function spawnSafe(
  cli: string,
  args: string[],
  stdio: 'inherit' | ['pipe' | 'inherit', 'pipe' | 'inherit', 'pipe' | 'inherit'],
) {
  const env = {
    ...process.env,
    EIDOS_WORKSPACE: process.env['EIDOS_WORKSPACE'] ?? getProjectRoot(),
    ...(process.env['EIDOS_AUTO_APPROVE'] === '1' ? { EIDOS_AUTO_APPROVE: '1' } : {}),
  };
  if (process.platform === 'win32') {
    // On Windows, .cmd/.bat files require shell execution. Use cmd /c with the
    // binary as a single quoted argument to avoid injection via args.
    const isCmdFile = cli.endsWith('.cmd') || cli.endsWith('.bat');
    if (isCmdFile) {
      return spawn('cmd', ['/c', cli, ...args], { stdio, env });
    }
    // For .exe and other binaries, spawn directly without shell (no DEP0190).
    return spawn(cli, args, { stdio, env });
  }
  return spawn(resolveBinary(cli), args, { stdio, shell: false, env });
}

/** Read all of stdin with a timeout. Returns empty string on TTY or timeout. */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => resolve(''), 5000);
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8').trim()); });
  });
}
