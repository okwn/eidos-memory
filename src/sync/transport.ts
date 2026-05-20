import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import Database from 'better-sqlite3';
import { getWorkspaceHash } from '../store/db.js';
import { listNodes } from '../store/nodes.js';
import { upsertNode } from '../store/nodes.js';
import { upsertEdge } from '../store/edges.js';
import {
  encryptPayload,
  decryptPayload,
  mergeLwwNodes,
  mergeTwoPSetEdges,
  type SyncPayload,
  type LwwNode,
  type TwoP_SetEntry,
  type EncryptedSyncPayload,
} from './crdt.js';

const SYNCABLE_TYPES = new Set(['decision', 'task', 'meso_block', 'error_memory']);

// ── Build export payload ──────────────────────────────────────────────────────

export function buildSyncPayload(db: Database.Database, workspaceRoot: string): SyncPayload {
  const wsHash = getWorkspaceHash(workspaceRoot);
  const now    = Date.now();

  // LWW nodes (only syncable types)
  const nodes: LwwNode[] = listNodes(db, undefined, 2000)
    .filter((n) => SYNCABLE_TYPES.has(n.type))
    .map((n) => ({
      id:            n.id,
      type:          n.type,
      properties:    n.properties as Record<string, unknown>,
      importance:    n.importance,
      ts:            n.updated_at,
      workspaceHash: wsHash,
    }));

  // 2P-Set edges
  const edgeRows = db.prepare(`SELECT * FROM edges`).all() as Array<{
    id: string; source_id: string; target_id: string;
    rel_type: string; weight: number; properties: string;
    removed_at?: number | null;
  }>;

  const edges: TwoP_SetEntry[] = edgeRows.map((e) => ({
    id:            e.id,
    source_id:     e.source_id,
    target_id:     e.target_id,
    rel_type:      e.rel_type,
    weight:        e.weight,
    properties:    JSON.parse(e.properties || '{}') as Record<string, unknown>,
    addedAt:       0,
    removedAt:     e.removed_at ?? null,
    workspaceHash: wsHash,
  }));

  return { version: 1, workspaceHash: wsHash, exportedAt: now, nodes, edges };
}

// ── Apply incoming payload to local DB ───────────────────────────────────────

export function applySyncPayload(db: Database.Database, payload: SyncPayload): void {
  const localNodes: LwwNode[] = listNodes(db, undefined, 2000)
    .filter((n) => SYNCABLE_TYPES.has(n.type))
    .map((n) => ({
      id: n.id, type: n.type,
      properties: n.properties as Record<string, unknown>,
      importance: n.importance, ts: n.updated_at,
      workspaceHash: payload.workspaceHash,
    }));

  const merged = mergeLwwNodes(localNodes, payload.nodes);
  for (const n of merged) {
    upsertNode(db, { id: n.id, type: n.type, properties: n.properties, importance: n.importance });
  }

  const localEdgeRows = db.prepare(`SELECT * FROM edges`).all() as Array<{
    id: string; source_id: string; target_id: string;
    rel_type: string; weight: number; properties: string;
  }>;
  const localEdges: TwoP_SetEntry[] = localEdgeRows.map((e) => ({
    id: e.id, source_id: e.source_id, target_id: e.target_id,
    rel_type: e.rel_type, weight: e.weight,
    properties: JSON.parse(e.properties || '{}') as Record<string, unknown>,
    addedAt: 0, removedAt: null, workspaceHash: payload.workspaceHash,
  }));

  const mergedEdges = mergeTwoPSetEdges(localEdges, payload.edges);
  for (const e of mergedEdges) {
    upsertEdge(db, {
      id: e.id, source_id: e.source_id, target_id: e.target_id,
      rel_type: e.rel_type, weight: e.weight, properties: e.properties,
    });
  }
}

// ── Shared-folder transport ───────────────────────────────────────────────────

export function syncToFolder(
  db: Database.Database,
  workspaceRoot: string,
  sharedFolder: string,
  sharedKey: string,
): void {
  const wsHash = getWorkspaceHash(workspaceRoot);
  fs.mkdirSync(sharedFolder, { recursive: true });

  // Export + encrypt
  const payload = buildSyncPayload(db, workspaceRoot);
  const enc     = encryptPayload(payload, sharedKey);
  const outFile = path.join(sharedFolder, `${wsHash}.sync`);
  fs.writeFileSync(outFile, JSON.stringify(enc));

  // Import all other workspaces in folder
  for (const file of fs.readdirSync(sharedFolder)) {
    if (!file.endsWith('.sync') || file === `${wsHash}.sync`) continue;
    try {
      const raw     = fs.readFileSync(path.join(sharedFolder, file), 'utf-8');
      const encData = JSON.parse(raw) as EncryptedSyncPayload;
      const remote  = decryptPayload(encData, sharedKey);
      applySyncPayload(db, remote);
    } catch { /* skip corrupt/wrong-key files */ }
  }

  console.log(`[eidos-sync] Synced with ${sharedFolder}`);
}

// ── HTTP relay transport ──────────────────────────────────────────────────────

export async function syncToRelay(
  db: Database.Database,
  workspaceRoot: string,
  relayUrl: string,
  sharedKey: string,
): Promise<void> {
  const wsHash  = getWorkspaceHash(workspaceRoot);
  const payload = buildSyncPayload(db, workspaceRoot);
  const enc     = encryptPayload(payload, sharedKey);
  const body    = Buffer.from(JSON.stringify(enc), 'utf-8');

  const lib   = relayUrl.startsWith('https') ? https : http;
  const url   = new URL(`${relayUrl}/sync/${wsHash}`);

  // Push local state
  await new Promise<void>((resolve, reject) => {
    const req = lib.request({ hostname: url.hostname, port: url.port || (relayUrl.startsWith('https') ? 443 : 80),
      path: url.pathname, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // Pull remote workspaces
  const remoteList = await new Promise<string[]>((resolve, reject) => {
    const req = lib.request({ hostname: url.hostname, port: url.port || (relayUrl.startsWith('https') ? 443 : 80),
      path: `${url.pathname}/../list`, method: 'GET',
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString()) as string[]); }
        catch { resolve([]); }
      });
    });
    req.on('error', reject);
    req.end();
  });

  for (const remoteHash of remoteList) {
    if (remoteHash === wsHash) continue;
    try {
      const remoteData = await new Promise<Buffer>((resolve, reject) => {
        const req = lib.request({ hostname: url.hostname,
          port: url.port || (relayUrl.startsWith('https') ? 443 : 80),
          path: `/${remoteHash}`, method: 'GET',
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.end();
      });
      const encRemote = JSON.parse(remoteData.toString()) as EncryptedSyncPayload;
      const remote    = decryptPayload(encRemote, sharedKey);
      applySyncPayload(db, remote);
    } catch { /* skip */ }
  }

  console.log(`[eidos-sync] Synced with relay ${relayUrl}`);
}
