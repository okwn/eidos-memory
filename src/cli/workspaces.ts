import fs from 'fs';
import path from 'path';
import os from 'os';
import { getWorkspaceHash } from '../store/db.js';

const WORKSPACES_FILE = path.join(os.homedir(), '.eidos', 'workspaces.json');
const ACTIVE_FILE     = path.join(os.homedir(), '.eidos', 'active-workspace');

interface WorkspaceEntry {
  name: string;
  path: string;
  hash: string;
  addedAt: number;
}

// ── Persistence helpers ───────────────────────────────────────────────────────
function loadWorkspaces(): WorkspaceEntry[] {
  if (!fs.existsSync(WORKSPACES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf-8')) as WorkspaceEntry[]; }
  catch { return []; }
}

function saveWorkspaces(entries: WorkspaceEntry[]): void {
  fs.mkdirSync(path.dirname(WORKSPACES_FILE), { recursive: true });
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(entries, null, 2));
}

export function registerWorkspace(workspacePath: string, name?: string): void {
  const resolved = path.resolve(workspacePath);
  const hash     = getWorkspaceHash(resolved);
  const entries  = loadWorkspaces();
  const existing = entries.findIndex(e => e.path === resolved);
  const entry: WorkspaceEntry = {
    name: name ?? path.basename(resolved),
    path: resolved,
    hash,
    addedAt: existing >= 0 ? entries[existing]!.addedAt : Date.now(),
  };
  if (existing >= 0) entries[existing] = entry;
  else entries.push(entry);
  saveWorkspaces(entries);
  // Also write active-workspace if none set
  if (!fs.existsSync(ACTIVE_FILE)) {
    fs.writeFileSync(ACTIVE_FILE, resolved);
  }
}

export function getActiveWorkspace(): string {
  if (fs.existsSync(ACTIVE_FILE)) {
    const p = fs.readFileSync(ACTIVE_FILE, 'utf-8').trim();
    if (p && fs.existsSync(p)) return p;
  }
  return process.env['EIDOS_WORKSPACE'] ?? process.cwd();
}

// ── CLI commands ──────────────────────────────────────────────────────────────
export async function listWorkspaces(): Promise<void> {
  const entries = loadWorkspaces();
  const active  = getActiveWorkspace();

  const CYAN = '\x1b[36m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';
  const GREEN = '\x1b[32m'; const DIM  = '\x1b[2m';

  console.log(`\n${BOLD}${CYAN}⚡ EidosCore Workspaces${RESET}\n`);

  if (entries.length === 0) {
    console.log(`  ${DIM}No workspaces registered yet.${RESET}`);
    console.log(`  ${DIM}Run: eidos init  in any project directory.${RESET}\n`);
    return;
  }

  for (const e of entries) {
    const isActive = e.path === active;
    const marker   = isActive ? `${GREEN}▶${RESET}` : ' ';
    const label    = isActive ? `${BOLD}${e.name}${RESET}` : e.name;
    const exists   = fs.existsSync(e.path);
    const status   = exists ? DIM + e.path + RESET : `\x1b[31m${e.path} (missing)\x1b[0m`;
    console.log(`  ${marker} ${label.padEnd(22)} ${DIM}[${e.hash}]${RESET}  ${status}`);
  }

  console.log(`\n  ${DIM}Active: ${active}${RESET}`);
  console.log(`  ${DIM}eidos workspaces switch <name|path>  — change active workspace${RESET}\n`);
}

export async function switchWorkspace(nameOrPath: string): Promise<void> {
  const entries = loadWorkspaces();
  const GREEN = '\x1b[32m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';

  let target = entries.find(e => e.name === nameOrPath || e.path === nameOrPath);

  // If not found but it's a valid dir path, register it on-the-fly
  if (!target && fs.existsSync(nameOrPath)) {
    registerWorkspace(nameOrPath);
    target = { name: path.basename(nameOrPath), path: path.resolve(nameOrPath), hash: getWorkspaceHash(nameOrPath), addedAt: Date.now() };
  }

  if (!target) {
    console.error(`[eidos] Workspace not found: ${nameOrPath}`);
    console.error(`[eidos] Run: eidos workspaces list  to see registered workspaces.`);
    process.exit(1);
  }

  fs.writeFileSync(ACTIVE_FILE, target.path);
  console.log(`\n${GREEN}${BOLD}✔ Active workspace → ${target.name}${RESET}`);
  console.log(`  ${target.path}\n`);
}

export async function removeWorkspace(nameOrPath: string): Promise<void> {
  let entries = loadWorkspaces();
  const before = entries.length;
  entries = entries.filter(e => e.name !== nameOrPath && e.path !== nameOrPath);

  if (entries.length === before) {
    console.error(`[eidos] Workspace not found: ${nameOrPath}`);
    process.exit(1);
  }
  saveWorkspaces(entries);
  console.log(`[eidos] Removed workspace: ${nameOrPath}`);

  // If was active, clear it
  if (fs.existsSync(ACTIVE_FILE)) {
    const active = fs.readFileSync(ACTIVE_FILE, 'utf-8').trim();
    if (active === nameOrPath || active === path.resolve(nameOrPath)) {
      fs.unlinkSync(ACTIVE_FILE);
      console.log('[eidos] Active workspace cleared — run: eidos workspaces switch <name>');
    }
  }
}
