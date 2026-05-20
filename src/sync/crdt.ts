import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LwwNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  importance: number;
  ts: number;           // last-write timestamp (logical clock)
  workspaceHash: string;
}

export interface TwoP_SetEntry {
  id: string;           // edge id
  source_id: string;
  target_id: string;
  rel_type: string;
  weight: number;
  properties: Record<string, unknown>;
  addedAt: number;
  removedAt: number | null;
  workspaceHash: string;
}

export interface SyncPayload {
  version: 1;
  workspaceHash: string;
  exportedAt: number;
  nodes: LwwNode[];
  edges: TwoP_SetEntry[];
}

export interface EncryptedSyncPayload {
  version: 1;
  iv: string;           // hex
  tag: string;          // hex — GCM auth tag
  ciphertext: string;   // hex
}

// ── Encryption / Decryption ───────────────────────────────────────────────────

function deriveKey(sharedKey: string): Buffer {
  return createHash('sha256').update(sharedKey).digest(); // 32 bytes for AES-256
}

export function encryptPayload(payload: SyncPayload, sharedKey: string): EncryptedSyncPayload {
  const key   = deriveKey(sharedKey);
  const iv    = randomBytes(12);              // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain  = Buffer.from(JSON.stringify(payload), 'utf-8');
  const enc1   = cipher.update(plain);
  const enc2   = cipher.final();
  const tag    = cipher.getAuthTag();
  return {
    version: 1,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: Buffer.concat([enc1, enc2]).toString('hex'),
  };
}

export function decryptPayload(enc: EncryptedSyncPayload, sharedKey: string): SyncPayload {
  const key      = deriveKey(sharedKey);
  const iv       = Buffer.from(enc.iv, 'hex');
  const tag      = Buffer.from(enc.tag, 'hex');
  const cipher   = Buffer.from(enc.ciphertext, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec1 = decipher.update(cipher);
  const dec2 = decipher.final();
  return JSON.parse(Buffer.concat([dec1, dec2]).toString('utf-8')) as SyncPayload;
}

// ── LWW merge ─────────────────────────────────────────────────────────────────

export function mergeLwwNodes(
  local: LwwNode[],
  remote: LwwNode[],
): LwwNode[] {
  const map = new Map<string, LwwNode>();
  for (const n of local)  map.set(n.id, n);
  for (const n of remote) {
    const existing = map.get(n.id);
    // Higher timestamp wins; on tie, higher workspaceHash wins (deterministic)
    if (!existing || n.ts > existing.ts || (n.ts === existing.ts && n.workspaceHash > existing.workspaceHash)) {
      map.set(n.id, n);
    }
  }
  return Array.from(map.values());
}

// ── 2P-Set merge for edges ────────────────────────────────────────────────────

export function mergeTwoPSetEdges(
  local: TwoP_SetEntry[],
  remote: TwoP_SetEntry[],
): TwoP_SetEntry[] {
  const map = new Map<string, TwoP_SetEntry>();
  for (const e of local)  map.set(e.id, e);
  for (const e of remote) {
    const existing = map.get(e.id);
    if (!existing) {
      map.set(e.id, e);
    } else {
      // Merge: addedAt = min (earliest add wins), removedAt = max (latest removal wins)
      map.set(e.id, {
        ...existing,
        addedAt:   Math.min(existing.addedAt, e.addedAt),
        removedAt: existing.removedAt !== null && e.removedAt !== null
          ? Math.max(existing.removedAt, e.removedAt)
          : (existing.removedAt ?? e.removedAt),
      });
    }
  }
  // Only include edges that are alive (not removed, or added after removal)
  return Array.from(map.values()).filter(
    (e) => e.removedAt === null || e.addedAt > e.removedAt,
  );
}
