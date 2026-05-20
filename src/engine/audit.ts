import fs from 'fs';
import path from 'path';
import os from 'os';
import { getWorkspaceHash } from '../store/db.js';

let _auditPath: string | null = null;

function getAuditPath(workspaceRoot?: string): string {
  if (_auditPath) return _auditPath;
  const wsHash = getWorkspaceHash(workspaceRoot ?? process.cwd());
  const dir = path.join(os.homedir(), '.eidos', wsHash);
  fs.mkdirSync(dir, { recursive: true });
  _auditPath = path.join(dir, 'audit.log');
  return _auditPath;
}

export interface AuditEntry {
  ts: number;
  event: 'context_assembled' | 'file_indexed' | 'secret_redacted' | 'file_excluded' | 'error_recorded' | 'qms_exported' | 'qms_imported';
  sessionId?: string;
  tokens?: number;
  tokensSaved?: number;
  nodeCount?: number;
  filePath?: string;
  fingerprint?: string;
  detail?: string;
}

export function writeAuditEntry(entry: AuditEntry, workspaceRoot?: string): void {
  try {
    const logPath = getAuditPath(workspaceRoot);
    const line = JSON.stringify({ ...entry, ts: entry.ts ?? Date.now() }) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch {
    // Audit log is best-effort; never throw
  }
}

export function readAuditLog(
  workspaceRoot?: string,
  limit = 100,
): AuditEntry[] {
  try {
    const logPath = getAuditPath(workspaceRoot);
    if (!fs.existsSync(logPath)) return [];
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as AuditEntry)
      .reverse(); // newest first
  } catch {
    return [];
  }
}

export function resetAuditPath(): void {
  _auditPath = null;
}
