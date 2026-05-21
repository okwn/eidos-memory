import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { fileURLToPath } from 'url';
import { getDb, getLifetimeSavings } from '../store/db.js';
import { countNodes, listNodes } from '../store/nodes.js';
import { readAuditLog } from '../engine/audit.js';
import { embed } from '../engine/embedding.js';
import { assembleContext } from '../engine/retrieval.js';
import {
  createSession, endSession, getActiveSessions,
  createObservation, getObservationsByProject, getObservationsByFile,
  createSummary, getSummariesByProject,
  recordPrompt, searchPrompts,
  enqueueMessage, dequeuePending, markMessageProcessing, markMessageCompleted, markMessageFailed,
} from '../store/memory_store.js';
import { handleSearchMemory } from '../mcp/tools/search_memory.js';
import { generateObservations, generateSessionSummary } from '../engine/generation.js';
import { buildEssentialsFromTurns } from '../engine/essentials.js';
import type { SummariserBackend } from '../engine/summariser/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function resolvePublicDir(): string {
  const candidates = [
    path.join(__dirname, 'public'),                        // dist/dashboard/public (compiled)
    path.join(__dirname, '..', '..', 'src', 'dashboard', 'public'), // from dist/ → src/
    path.join(__dirname, '..', 'dashboard', 'public'),     // another common layout
    path.join(process.cwd(), 'src', 'dashboard', 'public'), // cwd fallback
  ];
  const found = candidates.find(d => fs.existsSync(path.join(d, 'index.html')));
  if (!found) {
    const tried = candidates.join('\n  ');
    console.error(`[eidos-dash] ERROR: Could not find dashboard public/ dir. Tried:\n  ${tried}`);
    console.error(`[eidos-dash] Run: npm run build  to copy public/ to dist/dashboard/public/`);
  }
  return found ?? candidates[0]!;
}

function serveStatic(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<h2>Not Found: ${path.basename(filePath)}</h2><p>Run <code>npm run build</code> to copy dashboard assets.</p>`);
    return;
  }
  const ext = path.extname(filePath);
  const mime: Record<string, string> = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon',
  };
  res.writeHead(200, { 'Content-Type': mime[ext] ?? 'text/plain' });
  res.end(fs.readFileSync(filePath));
}

function buildApiStats() {
  const db = getDb();
  const totalNodes   = countNodes(db);
  const chunkNodes   = countNodes(db, 'chunk');
  const fileNodes    = countNodes(db, 'file');
  const turnNodes    = countNodes(db, 'conversation_turn');
  const mesoNodes    = countNodes(db, 'meso_block');
  const decisionNodes = countNodes(db, 'decision');
  const errorNodes   = countNodes(db, 'error_memory');
  const totalEdges   = (db.prepare(`SELECT COUNT(*) as cnt FROM edges`).get() as { cnt: number }).cnt;
  const feedback     = (db.prepare(`SELECT AVG(score) as avg, COUNT(*) as cnt FROM feedback`).get() as { avg: number; cnt: number });
  const weightRows   = db.prepare(`SELECT key, value FROM weights`).all() as Array<{ key: string; value: number }>;
  const weights      = Object.fromEntries(weightRows.map((r) => [r.key, r.value]));
  const auditEntries = readAuditLog(undefined, 20);
  const sessionTokensSaved = auditEntries
    .filter((e) => e.event === 'context_assembled')
    .reduce((s, e) => s + (e.tokensSaved ?? 0), 0);
  const costPer1k    = 0.015;
  const sessionDollarsSaved = (sessionTokensSaved / 1000) * costPer1k;
  const lifetime = getLifetimeSavings(db);
  // Use lifetime as primary source (persists across restarts), add any session delta
  const tokensSaved  = lifetime.tokens_saved  + sessionTokensSaved;
  const dollarsSaved = lifetime.dollars_saved + sessionDollarsSaved;
  return { totalNodes, chunkNodes, fileNodes, turnNodes, mesoNodes, decisionNodes, errorNodes, totalEdges, avgFeedback: feedback.avg ?? 0, feedbackCount: feedback.cnt, weights, tokensSaved, dollarsSaved, promptsWrapped: lifetime.prompts_count };
}

function buildApiGraph() {
  const db    = getDb();
  const nodes = listNodes(db, undefined, 300).map((n) => ({
    id: n.id, type: n.type, importance: n.importance,
    label: (() => {
      const p = n.properties as Record<string, unknown>;
      return String(p['name'] ?? p['path'] ?? p['statement'] ?? p['goal'] ?? n.type).slice(0, 30);
    })(),
  }));
  const edges = (db.prepare(`SELECT id, source_id, target_id, rel_type, weight FROM edges LIMIT 500`).all() as Array<{ id: string; source_id: string; target_id: string; rel_type: string; weight: number }>);
  return { nodes, edges };
}

export function startDashboard(port: number): void {
  const staticDir = resolvePublicDir();

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CORS for local dev / browser extension — restrict to trusted origins
    const origin = req.headers.origin ?? '';
    const allowedOrigins = [
      'http://localhost', 'http://127.0.0.1',
      `http://localhost:${port}`, `http://127.0.0.1:${port}`,
    ];
    const isAllowed = !origin
      || allowedOrigins.some(o => origin === o || origin.startsWith(o + ':'))
      || origin.startsWith('chrome-extension://')
      || origin.startsWith('moz-extension://');
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === '/api/stats') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildApiStats()));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    if (url === '/api/graph') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildApiGraph()));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    if (url === '/api/lifetime') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getLifetimeSavings(getDb())));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    if (url === '/api/audit') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(readAuditLog(undefined, 50)));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

        if (url === '/api/mcp-status') {
      try {
        const mcpPort = 3742;
        const pidPath = path.join(os.homedir(), '.eidos', 'daemon.pid');
        let pid = null;
        let alive = false;
        if (fs.existsSync(pidPath)) {
          const rawPid = fs.readFileSync(pidPath, 'utf-8').trim();
          const parsedPid = parseInt(rawPid, 10);
          pid = Number.isNaN(parsedPid) ? null : parsedPid;
          if (pid !== null) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
        }
        const connected = await new Promise(connectResolve => {
          const sock = new net.Socket();
          sock.setTimeout(1000);
          sock.on('connect', () => { sock.destroy(); connectResolve(true); });
          sock.on('error', () => connectResolve(false));
          sock.on('timeout', () => { sock.destroy(); connectResolve(false); });
          sock.connect(mcpPort, '127.0.0.1');
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ connected, pid, alive, mcpPort, proxyPort: 4141, dashPort: 7842 }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // POST /api/assemble — assemble context for a query (used by browser extension)
    if (method === 'POST' && url === '/api/assemble') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { query: string; activeFile?: string | null; budget?: number };
        const query = parsed.query ?? '';
        if (!query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'query is required' }));
          return;
        }

        const db = getDb();
        const budget = parsed.budget ?? 2000;
        const queryEmbedding = await embed(query);

        const essentials = buildEssentialsFromTurns(db);

        const result = await assembleContext(db, query, queryEmbedding, parsed.activeFile ?? null, budget, essentials);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          context: result.contextString,
          tokens: result.tokens,
          tokensSaved: result.tokensSaved,
          breakdown: result.breakdown,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // ── Structured Memory API (Claude Mem-inspired) ───────────────────────

    // GET /api/health — health check
    if (url === '/api/health') {
      const db = getDb();
      const nodeCount = countNodes(db);
      const activeSessions = getActiveSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', nodeCount, activeSessions: activeSessions.length, uptime: process.uptime() }));
      return;
    }

    // GET /api/context/inject?project=X — full context timeline for a project
    if (url.startsWith('/api/context/inject')) {
      try {
        const params = new URL(url, 'http://localhost').searchParams;
        const project = params.get('project') ?? process.cwd();

        // Get recent summaries
        const summaries = getSummariesByProject(project, 3);
        // Get recent observations
        const observations = getObservationsByProject(project, 20);

        let context = `<eidos-context>\nProject: ${project}\nMemory Timeline\n`;

        if (summaries.length > 0) {
          const s = summaries[0]!;
          context += `\n── Session Summary (${new Date(s.ended_at).toLocaleString()}) ──\n`;
          if (s.user_requests) context += `  User wanted: ${s.user_requests}\n`;
          if (s.learnings) context += `  Learnings: ${s.learnings}\n`;
          if (s.completed_tasks) context += `  Completed: ${s.completed_tasks}\n`;
          if (s.next_steps) context += `  Next: ${s.next_steps}\n`;
        }

        if (observations.length > 0) {
          context += `\n── Past Observations ──\n`;
          for (const obs of observations.slice(0, 10)) {
            const files = obs.files_modified ? JSON.parse(obs.files_modified) as string[] : [];
            context += `  • ${obs.title}\n`;
            if (files.length > 0) context += `    Files: ${files.join(', ')}\n`;
            if (obs.narrative) context += `    Details: ${obs.narrative.slice(0, 150)}\n`;
          }
        }

        context += `</eidos-context>`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ context, summaries: summaries.length, observations: observations.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // POST /api/sessions/init — create a new session
    if (method === 'POST' && url === '/api/sessions/init') {
      try {
        const body = await readBody(req);
        const { project, platform, session_id } = JSON.parse(body) as { project: string; platform: string; session_id?: string };
        const id = createSession(project ?? process.cwd(), platform ?? 'unknown', session_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ session_id: id }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // POST /api/sessions/end — end a session
    if (method === 'POST' && url === '/api/sessions/end') {
      try {
        const body = await readBody(req);
        const { session_id } = JSON.parse(body) as { session_id: string };
        endSession(session_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // POST /api/sessions/observations — store an observation
    if (method === 'POST' && url === '/api/sessions/observations') {
      try {
        const body = await readBody(req);
        const obs = JSON.parse(body) as {
          session_id: string; project: string; type: string; title: string;
          narrative?: string; facts?: string[]; files_read?: string[]; files_modified?: string[];
        };
        const id = createObservation({
          session_id: obs.session_id,
          project: obs.project ?? process.cwd(),
          type: obs.type ?? 'observation',
          title: obs.title,
          narrative: obs.narrative,
          facts: obs.facts,
          files_read: obs.files_read,
          files_modified: obs.files_modified,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ observation_id: id }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // POST /api/sessions/summarize — create a session summary
    if (method === 'POST' && url === '/api/sessions/summarize') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body) as {
          session_id: string; project: string;
          user_requests?: string; learnings?: string; completed_tasks?: string; next_steps?: string;
        };
        const id = createSummary({
          session_id: data.session_id,
          project: data.project ?? process.cwd(),
          user_requests: data.user_requests,
          learnings: data.learnings,
          completed_tasks: data.completed_tasks,
          next_steps: data.next_steps,
        });
        // Also end the session
        endSession(data.session_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ summary_id: id }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // POST /api/sessions/trigger-summarize — enqueue async summarization
    if (method === 'POST' && url === '/api/sessions/trigger-summarize') {
      try {
        const body = await readBody(req);
        const { session_id, project } = JSON.parse(body) as { session_id: string; project: string };
        const msgId = enqueueMessage({
          session_id,
          project: project ?? process.cwd(),
          message_type: 'summarize',
          payload: { session_id, project: project ?? process.cwd() },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message_id: msgId, status: 'queued' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // GET /api/search?q=...&project=X — search memories
    if (url.startsWith('/api/search')) {
      try {
        const params = new URL(url, 'http://localhost').searchParams;
        const query = params.get('q') ?? '';
        params.get('project') ?? process.cwd();
        const mode = params.get('mode') ?? 'semantic';

        if (!query && mode === 'semantic') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'q parameter required for semantic search' }));
          return;
        }

        const result = await handleSearchMemory({ query, mode, budget_tokens: 2000 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(result.content[0]!.text);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // GET /api/observations/by-file?file=X&project=X — observations for a specific file
    if (url.startsWith('/api/observations/by-file')) {
      try {
        const params = new URL(url, 'http://localhost').searchParams;
        const file = params.get('file') ?? '';
        const project = params.get('project') ?? process.cwd();
        const observations = getObservationsByFile(file, project);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ observations }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // POST /api/prompts — record a user prompt
    if (method === 'POST' && url === '/api/prompts') {
      try {
        const body = await readBody(req);
        const { session_id, project, prompt } = JSON.parse(body) as { session_id: string; project: string; prompt: string };
        const id = recordPrompt(session_id, project ?? process.cwd(), prompt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: id }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // GET /api/prompts/search?q=...&project=X — search prompts
    if (url.startsWith('/api/prompts/search')) {
      try {
        const params = new URL(url, 'http://localhost').searchParams;
        const query = params.get('q') ?? '';
        const project = params.get('project') ?? process.cwd();
        const results = searchPrompts(project, query);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // Static files
    const filePath = url === '/' ? path.join(staticDir, 'index.html') : path.join(staticDir, url);
    serveStatic(res, filePath);
  });

  // ── Background Queue Processor ─────────────────────────────────────────
  // Processes pending summarization jobs every 30 seconds.
  // This is non-blocking — observations are generated async after session end.

  const processQueue = async () => {
    const messages = dequeuePending(3);
    for (const msg of messages) {
      if (msg.attempts >= 3) {
        markMessageFailed(msg.id, 'Max attempts exceeded');
        continue;
      }
      markMessageProcessing(msg.id);
      try {
        const payload = JSON.parse(msg.payload) as { session_id: string; project: string };
        const db = getDb();

        // Gather conversation turns from the session
        const turns = db.prepare(`
          SELECT properties FROM nodes
          WHERE type = 'conversation_turn' AND json_extract(properties, '$.session_id') = ?
          ORDER BY last_accessed ASC LIMIT 20
        `).all(payload.session_id) as Array<{ properties: string }>;

        const conversation = turns.map((t) => {
          const p = JSON.parse(t.properties) as { role: string; content: string; micro_summary?: string };
          return { role: p.role, content: p.content ?? p.micro_summary ?? '' };
        });

        if (conversation.length > 0) {
          const backend: SummariserBackend = (process.env['EIDOS_SUMMARISER'] as SummariserBackend) ?? 'local';
          const [observations, summary] = await Promise.all([
            generateObservations(conversation, backend),
            generateSessionSummary(conversation, backend),
          ]);

          for (const obs of observations) {
            createObservation({
              session_id: payload.session_id,
              project: payload.project,
              type: obs.type,
              title: obs.title,
              narrative: obs.narrative,
              facts: obs.facts,
              concepts: obs.concepts,
              files_read: obs.files_read,
              files_modified: obs.files_modified,
            });
          }

          createSummary({
            session_id: payload.session_id,
            project: payload.project,
            user_requests: summary.user_requests,
            investigations: summary.investigations,
            learnings: summary.learnings,
            completed_tasks: summary.completed_tasks,
            next_steps: summary.next_steps,
          });
        }

        markMessageCompleted(msg.id);
      } catch (err) {
        markMessageFailed(msg.id, err instanceof Error ? err.message : String(err));
      }
    }
  };

  // Run processor every 30 seconds
  const queueInterval = setInterval(processQueue, 30000);
  // Also run immediately on start
  processQueue();

  server.listen(port, () => {
    console.log(`[eidos-dash] Dashboard running at http://localhost:${port}`);
    console.log(`[eidos-dash] Open your browser to view the graph explorer.`);
  });

  process.on('SIGINT', () => { clearInterval(queueInterval); server.close(); process.exit(0); });
}
