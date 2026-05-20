import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { countNodes } from '../store/nodes.js';
import { getDb } from '../store/db.js';

const TELEMETRY_URL = 'https://telemetry.eidos-memory.dev/v1/ping'; // opt-in, open-source
const TELEMETRY_FILE = path.join(os.homedir(), '.eidos', 'telemetry.json');
const MS_PER_DAY = 86_400_000;

interface TelemetryState {
  lastSent: number;
  optedIn: boolean;
  installId: string;
}

function loadState(): TelemetryState {
  try {
    if (fs.existsSync(TELEMETRY_FILE)) {
      return JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf-8')) as TelemetryState;
    }
  } catch { /* ignore */ }
  return { lastSent: 0, optedIn: false, installId: crypto.randomUUID() };
}

function saveState(state: TelemetryState): void {
  try {
    fs.mkdirSync(path.dirname(TELEMETRY_FILE), { recursive: true });
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

export function optInTelemetry(): void {
  const state = loadState();
  state.optedIn = true;
  saveState(state);
  console.log('[eidos] Telemetry opted in. Thank you for helping improve EidosCore!');
  console.log('[eidos] We collect: version, node count, token savings %, OS. Never code, prompts, or file paths.');
}

export function optOutTelemetry(): void {
  const state = loadState();
  state.optedIn = false;
  saveState(state);
  console.log('[eidos] Telemetry opted out. No data will be sent.');
}

export function isTelemetryEnabled(): boolean {
  const state = loadState();
  return state.optedIn;
}

export async function maybeSendTelemetry(): Promise<void> {
  const state = loadState();
  if (!state.optedIn) return;
  if (Date.now() - state.lastSent < MS_PER_DAY) return;

  try {
    const db = getDb();
    const nodeCount  = countNodes(db);
    const auditRows  = db.prepare(`SELECT tokens_saved FROM sessions`).all() as Array<{ tokens_saved: number }>;
    const totalSaved = auditRows.reduce((s, r) => s + (r.tokens_saved ?? 0), 0);

    // Read version from package.json safely
    let version = '0.1.0';
    try {
      const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../../package.json');
      if (fs.existsSync(pkgPath)) {
        version = (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string }).version;
      }
    } catch { /* ignore */ }

    const payload = JSON.stringify({
      installId:    state.installId,
      version,
      nodeCount,
      tokensSaved:  totalSaved,
      os:           process.platform,
      arch:         process.arch,
      nodeVersion:  process.versions.node,
    });

    await new Promise<void>((resolve) => {
      const req = https.request(TELEMETRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      });
      req.on('error', () => resolve()); // never throw — telemetry is best-effort
      req.on('response', (res) => { res.resume(); resolve(); });
      req.setTimeout(5000, () => { req.destroy(); resolve(); });
      req.write(payload);
      req.end();
    });

    state.lastSent = Date.now();
    saveState(state);
  } catch { /* ignore */ }
}
