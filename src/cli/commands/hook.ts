/**
 * eidos hook — Stdio JSON Hook Handler
 *
 * Backbone for hook-based integrations (Gemini CLI, Cursor, Windsurf, etc.).
 * Reads JSON from stdin, normalizes via platform adapter, performs the
 * requested action, and writes JSON to stdout.
 *
 * Usage: eidos hook <platform> <event>
 *   platform: gemini | cursor | windsurf | claude
 *   event:    session-init | context | observation | summarize
 *
 * stdin:  JSON payload from the CLI/IDE hook
 * stdout: JSON result (context string, observation id, or summary status)
 */
import { assembleContext } from '../../engine/retrieval.js';
import { embed } from '../../engine/embedding.js';
import { getDb } from '../../store/db.js';
import { createSession, createObservation, createSummary, endSession } from '../../store/memory_store.js';
import { listNodes } from '../../store/nodes.js';
import { generateObservations, generateSessionSummary } from '../../engine/generation.js';
import { stripPrivateTags } from '../../engine/privacy.js';
import type { SummariserBackend } from '../../engine/summariser/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface HookPayload {
  session_id?: string;
  project?: string;
  cwd?: string;
  prompt?: string;
  response?: string;
  tool_name?: string;
  tool_input?: string;
  files_read?: string[];
  files_modified?: string[];
  conversation?: Array<{ role: string; content: string }>;
  budget?: number;
}

interface HookResponse {
  ok: boolean;
  session_id?: string;
  context?: string;
  tokens?: number;
  observation_id?: string;
  summary_id?: string;
  message?: string;
  error?: string;
}

// ── Adapter Normalization ──────────────────────────────────────────────────

/**
 * Normalize raw hook input into a standard payload based on platform adapter.
 * Different platforms send different JSON shapes — this unifies them.
 */
function normalizeHookEvent(platform: string, _event: string, raw: Record<string, unknown>): HookPayload {
  const cwd = (raw['project'] ?? raw['cwd'] ?? raw['workingDirectory'] ?? process.cwd()) as string;
  const base: HookPayload = { cwd, project: cwd };

  switch (platform) {
    case 'gemini':
      // Gemini sends: { session_id, prompt, tools_used, ... }
      base.session_id = (raw['session_id'] ?? raw['sessionId']) as string;
      base.prompt = raw['prompt'] as string;
      base.response = raw['response'] as string;
      base.files_read = raw['files_read'] as string[];
      base.files_modified = raw['files_modified'] as string[];
      break;

    case 'cursor':
      // Cursor sends: { sessionId, userPrompt, response, fileChanges, ... }
      base.session_id = (raw['sessionId'] ?? raw['session_id']) as string;
      base.prompt = (raw['userPrompt'] ?? raw['prompt']) as string;
      base.response = (raw['response'] ?? raw['assistantResponse']) as string;
      base.files_modified = raw['fileChanges'] as string[];
      break;

    case 'windsurf':
      // Windsurf sends: { session_id, user_message, cascade_response, ... }
      base.session_id = (raw['session_id'] ?? raw['sessionId']) as string;
      base.prompt = (raw['user_message'] ?? raw['prompt']) as string;
      base.response = (raw['cascade_response'] ?? raw['response']) as string;
      base.files_read = raw['files_read'] as string[];
      base.files_modified = raw['files_modified'] as string[];
      break;

    default:
      // Generic: passthrough
      base.session_id = (raw['session_id'] ?? raw['sessionId']) as string;
      base.prompt = raw['prompt'] as string;
      base.response = raw['response'] as string;
      break;
  }

  // If no session_id, auto-create one from cwd
  if (!base.session_id) {
    base.session_id = `hook:${platform}:${Date.now()}`;
  }

  return base;
}

// ── Event Handlers ─────────────────────────────────────────────────────────

async function handleSessionInit(payload: HookPayload): Promise<HookResponse> {
  const project = payload.project ?? payload.cwd ?? process.cwd();
  const sessionId = createSession(project, payload.session_id ? platformFromSessionId(payload.session_id) : 'hook', payload.session_id);
  return { ok: true, session_id: sessionId, message: `Session ${sessionId} initialized` };
}

async function handleContext(payload: HookPayload): Promise<HookResponse> {
  const db = getDb();
  const query = payload.prompt ?? payload.response ?? 'context';
  const budget = payload.budget ?? 2000;
  const queryEmbedding = await embed(query);

  // Gather recent conversation turns as essentials
  const essentials: Array<{ label: string; content: string }> = [];
  const turns = listNodes(db, 'conversation_turn', 6).slice(-3);
  for (const t of turns) {
    const p = t.properties as Record<string, unknown>;
    essentials.push({ label: String(p['role']), content: String(p['micro_summary'] ?? '') });
  }

  const result = await assembleContext(db, query, queryEmbedding, null, budget, essentials, { isFirstCall: true });

  return {
    ok: true,
    session_id: payload.session_id,
    context: result.contextString,
    tokens: result.tokens,
    message: `Context assembled: ${result.tokens} tokens, ${result.breakdown.length} items`,
  };
}

async function handleObservation(payload: HookPayload): Promise<HookResponse> {
  const project = payload.project ?? process.cwd();
  const sessionId = payload.session_id ?? createSession(project, 'hook');

  // Strip private tags before storing
  const narrative = payload.response
    ? stripPrivateTags(payload.response).slice(0, 1000)
    : payload.prompt
      ? stripPrivateTags(payload.prompt).slice(0, 500)
      : '';

  if (!narrative.trim()) {
    return { ok: true, session_id: sessionId, message: 'No content to store (empty after private tag stripping)' };
  }

  const id = createObservation({
    session_id: sessionId,
    project,
    type: 'observation',
    title: narrative.split('\n')[0]?.trim().slice(0, 80) ?? 'Hook observation',
    narrative,
    files_read: payload.files_read,
    files_modified: payload.files_modified,
  });

  return { ok: true, session_id: sessionId, observation_id: id };
}

async function handleSummarize(payload: HookPayload): Promise<HookResponse> {
  const db = getDb();
  const project = payload.project ?? process.cwd();
  const sessionId = payload.session_id;

  if (!sessionId) {
    return { ok: false, error: 'session_id required for summarize event' };
  }

  // Gather conversation turns from the session
  const turns = db.prepare(`
    SELECT properties FROM nodes
    WHERE type = 'conversation_turn' AND json_extract(properties, '$.session_id') = ?
    ORDER BY last_accessed ASC LIMIT 20
  `).all(sessionId) as Array<{ properties: string }>;

  const conversation = turns.map((t) => {
    const p = JSON.parse(t.properties) as { role: string; content: string; micro_summary?: string };
    return { role: p.role, content: p.content ?? p.micro_summary ?? '' };
  });

  // Generate observations using the AI pipeline
  const backend: SummariserBackend = (process.env['EIDOS_SUMMARISER'] as SummariserBackend) ?? 'local';
  const [observations, summary] = await Promise.all([
    generateObservations(conversation, backend),
    generateSessionSummary(conversation, backend),
  ]);

  // Store observations
  for (const obs of observations) {
    createObservation({
      session_id: sessionId,
      project,
      type: obs.type,
      title: obs.title,
      narrative: obs.narrative,
      facts: obs.facts,
      concepts: obs.concepts,
      files_read: obs.files_read,
      files_modified: obs.files_modified,
    });
  }

  // Store summary
  const summaryId = createSummary({
    session_id: sessionId,
    project,
    user_requests: summary.user_requests,
    investigations: summary.investigations,
    learnings: summary.learnings,
    completed_tasks: summary.completed_tasks,
    next_steps: summary.next_steps,
  });

  // End the session
  endSession(sessionId);

  return {
    ok: true,
    session_id: sessionId,
    summary_id: summaryId,
    message: `Generated ${observations.length} observations and summary`,
  };
}

// ── Main Hook Handler ──────────────────────────────────────────────────────

export async function handleHook(platform: string, event: string): Promise<void> {
  // Read JSON payload from stdin
  const stdinBuffer = await readStdin();
  let raw: Record<string, unknown> = {};

  if (stdinBuffer.trim()) {
    try {
      raw = JSON.parse(stdinBuffer) as Record<string, unknown>;
    } catch {
      writeResponse({ ok: false, error: 'Invalid JSON on stdin' });
      return;
    }
  }

  // Normalize the event through the platform adapter
  const payload = normalizeHookEvent(platform, event, raw);

  // Route to the appropriate handler
  let response: HookResponse;
  try {
    switch (event) {
      case 'session-init':
        response = await handleSessionInit(payload);
        break;
      case 'context':
        response = await handleContext(payload);
        break;
      case 'observation':
        response = await handleObservation(payload);
        break;
      case 'summarize':
        response = await handleSummarize(payload);
        break;
      default:
        response = { ok: false, error: `Unknown event: ${event}. Supported: session-init, context, observation, summarize` };
    }
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  writeResponse(response);
}

// ── I/O Utilities ──────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    // If stdin is a TTY (manual invocation), resolve immediately
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    const chunks: Buffer[] = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    // Timeout after 10s for hung inputs
    setTimeout(() => {
      if (chunks.length === 0) resolve('');
    }, 10000);
  });
}

function writeResponse(response: HookResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function platformFromSessionId(sessionId: string): string {
  const match = /hook:(\w+):/.exec(sessionId);
  return match ? match[1]! : 'hook';
}