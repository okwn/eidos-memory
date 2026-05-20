import fs from 'fs';
import path from 'path';
import { getDb } from '../../store/db.js';
import { upsertNode, getNode } from '../../store/nodes.js';
import { upsertEdge } from '../../store/edges.js';
import { insertVec } from '../../store/vector.js';
import { chunkFile } from '../../engine/ingestion/chunker.js';
import { skeletonToString } from '../../engine/ingestion/skeleton.js';
import { computeDiff } from '../../engine/ingestion/differ.js';
import { embed } from '../../engine/embedding.js';
import { redactSecrets } from '../../engine/privacy.js';
import { countTokens } from '../../engine/tokens.js';

export async function handleUpdateFile(params: Record<string, unknown>) {
  const db = getDb();
  const filePath = String(params['file_uri'] ?? '');

  if (!fs.existsSync(filePath)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'File not found' }) }], isError: true };
  }

  const fileId = `file:${filePath}`;
  const existingFile = getNode(db, fileId);
  const changedChunks: string[] = [];
  const diffSummaries: string[] = [];

  const newChunks = await chunkFile(filePath);

  for (const chunk of newChunks) {
    const chunkId = `chunk:${filePath}:${chunk.startLine}`;
    const existing = getNode(db, chunkId);
    const newBody = redactSecrets(chunk.fullBody);
    const oldBody = existing ? String((existing.properties as Record<string, unknown>)['fullBody'] ?? '') : '';

    const diffResult = computeDiff(oldBody, newBody);

    if (!existing || diffResult.hasChanges) {
      const skeleton = skeletonToString(chunk);
      const embedding = await embed(`${chunk.name ?? ''} ${skeleton}`);
      const tokenCount = countTokens(skeleton);

      // Store old chunk with VERSION_OF link
      if (existing) {
        const oldChunkId = `chunk:${filePath}:${chunk.startLine}:old:${Date.now()}`;
        upsertNode(db, {
          id: oldChunkId,
          type: 'chunk',
          properties: { ...(existing.properties as Record<string, unknown>), archived: true },
          embedding: existing.embedding ?? undefined,
          importance: 0.1,
        });
        upsertEdge(db, {
          source_id: chunkId,
          target_id: oldChunkId,
          rel_type: 'VERSION_OF',
          weight: 1.0,
          properties: { diff: diffResult.diffText },
        });
      }

      upsertNode(db, {
        id: chunkId,
        type: 'chunk',
        properties: {
          filePath,
          relPath: path.relative(process.cwd(), filePath),
          language: chunk.language,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          chunkType: chunk.chunkType,
          name: chunk.name,
          skeleton,
          fullBody: newBody,
          token_count: tokenCount,
          confidence: chunk.confidence,
          last_diff: diffResult.diffText,
        },
        embedding,
        importance: 0.5,
      });
      insertVec(db, chunkId, embedding);

      changedChunks.push(chunkId);
      if (diffResult.hasChanges) diffSummaries.push(diffResult.diffText.slice(0, 100));
    }
  }

  // Update file node
  if (existingFile) {
    const stat = fs.statSync(filePath);
    upsertNode(db, {
      id: fileId,
      type: 'file',
      properties: { ...(existingFile.properties as Record<string, unknown>), last_modified: stat.mtimeMs },
      importance: 0.5,
    });
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        changed_chunks: changedChunks.length,
        diff_summary: diffSummaries.join('\n').slice(0, 500),
      }),
    }],
  };
}
