import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { fileURLToPath } from 'url';
import { getDb, getLifetimeSavings } from '../store/db.js';
import { countNodes, listNodes } from '../store/nodes.js';
import { readAuditLog } from '../engine/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');

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

    // Static files
    const filePath = url === '/' ? path.join(staticDir, 'index.html') : path.join(staticDir, url);
    serveStatic(res, filePath);
  });

  server.listen(port, () => {
    console.log(`[eidos-dash] Dashboard running at http://localhost:${port}`);
    console.log(`[eidos-dash] Open your browser to view the graph explorer.`);
  });

  process.on('SIGINT', () => { server.close(); process.exit(0); });
}
