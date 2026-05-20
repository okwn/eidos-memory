import fs from 'fs';
import path from 'path';
import { getDb } from '../store/db.js';
import { getNode, upsertNode } from '../store/nodes.js';
import { insertVec } from '../store/vector.js';
import { handleGenerateQms } from '../mcp/tools/generate_qms.js';
import { handleLoadQms } from '../mcp/tools/load_qms.js';

export async function exportQms(sessionId: string, outFile: string): Promise<void> {
  const db = getDb();

  console.log(`[eidos] Generating QMS for session: ${sessionId}...`);
  const result = await handleGenerateQms({ session_id: sessionId });

  const content = result.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('QMS generation returned no content');
  }

  const data = JSON.parse(content.text) as { qms_id?: string; error?: string };
  if (data.error) throw new Error(data.error);

  const qmsId = data.qms_id!;
  const qmsNode = getNode(db, qmsId);
  if (!qmsNode) throw new Error(`QMS node not found: ${qmsId}`);

  const exportPayload = {
    version: '1',
    qms_id: qmsId,
    session_id: sessionId,
    exported_at: Date.now(),
    node: {
      id: qmsNode.id,
      type: qmsNode.type,
      properties: qmsNode.properties,
      embedding: qmsNode.embedding ? Array.from(qmsNode.embedding) : null,
      importance: qmsNode.importance,
    },
  };

  const outPath = path.resolve(outFile);
  fs.writeFileSync(outPath, JSON.stringify(exportPayload, null, 2));
  console.log(`[eidos] QMS exported to ${outPath}`);
  console.log(`[eidos] QMS ID: ${qmsId} | top50: ${(qmsNode.properties as Record<string, unknown[]>)['top50_node_ids']?.length ?? 0} nodes`);
}

export async function importQms(inFile: string): Promise<void> {
  const db = getDb();
  const inPath = path.resolve(inFile);

  if (!fs.existsSync(inPath)) {
    throw new Error(`File not found: ${inPath}`);
  }

  const raw = fs.readFileSync(inPath, 'utf-8');
  const payload = JSON.parse(raw) as {
    version: string;
    qms_id: string;
    node: {
      id: string;
      type: string;
      properties: Record<string, unknown>;
      embedding: number[] | null;
      importance: number;
    };
  };

  if (payload.version !== '1') {
    throw new Error(`Unsupported QMS version: ${payload.version}`);
  }

  const embedding = payload.node.embedding
    ? new Float32Array(payload.node.embedding)
    : undefined;

  upsertNode(db, {
    id: payload.node.id,
    type: payload.node.type,
    properties: payload.node.properties,
    embedding,
    importance: payload.node.importance,
  });

  if (embedding) {
    insertVec(db, payload.node.id, embedding);
  }

  console.log(`[eidos] QMS imported: ${payload.qms_id}`);

  // Pre-warm cache
  const loadResult = await handleLoadQms({ qms_id: payload.qms_id });
  const loadContent = loadResult.content[0];
  if (loadContent?.type === 'text') {
    const loadData = JSON.parse(loadContent.text) as { primed_nodes_count?: number };
    console.log(`[eidos] Cache primed: ${loadData.primed_nodes_count ?? 0} nodes`);
  }
}
