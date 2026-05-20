import fs from 'fs';
import path from 'path';
import { getDb } from '../../store/db.js';
import { upsertNode } from '../../store/nodes.js';
import { upsertEdge } from '../../store/edges.js';
import { insertVec } from '../../store/vector.js';
import { chunkFile, getSupportedExtensions } from '../../engine/ingestion/chunker.js';
import { skeletonToString } from '../../engine/ingestion/skeleton.js';
import { embed } from '../../engine/embedding.js';
import { isFileAllowed, initPrivacyFirewall, redactSecrets } from '../../engine/privacy.js';
import { countTokens } from '../../engine/tokens.js';

interface IndexProjectParams {
  path: string;
  languages?: string[];
}

interface IndexProjectResult {
  node_count: number;
  chunk_count: number;
  file_count: number;
  duration_ms: number;
}

// Concurrency control
const MAX_CONCURRENT = 4;

async function asyncPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const p = (async () => {
      const result = await fn(item);
      results.push(result);
    })();
    executing.add(p);
    const cleanup = () => executing.delete(p);
    p.then(cleanup, cleanup);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

interface FileProcessingResult {
  fileNodeAdded: boolean;
  chunksAdded: number;
}

export async function indexProject(params: IndexProjectParams): Promise<IndexProjectResult> {
  const start = Date.now();
  const db = getDb();
  const rootPath = path.resolve(params.path);
  initPrivacyFirewall(rootPath);

  const supportedExts = getSupportedExtensions();
  const files = walkDir(rootPath, supportedExts);

  let nodeCount = 0;
  let chunkCount = 0;

  // Upsert workspace root node
  const workspaceId = `workspace:${rootPath}`;
  upsertNode(db, {
    id: workspaceId,
    type: 'workspace',
    properties: { path: rootPath },
    importance: 1.0,
  });
  nodeCount++;

  // Pre-filter allowed files
  const allowedFiles = files.filter(f => isFileAllowed(f));

  // Process files in parallel with concurrency limit
  const fileResults = await asyncPool(allowedFiles, MAX_CONCURRENT, async (filePath) => {
    const relPath = path.relative(rootPath, filePath);
    const result: FileProcessingResult = {
      fileNodeAdded: false,
      chunksAdded: 0,
    };

    try {
      // Upsert file node
      const fileId = `file:${filePath}`;
      const stat = fs.statSync(filePath);
      upsertNode(db, {
        id: fileId,
        type: 'file',
        properties: { path: filePath, relPath, last_modified: stat.mtimeMs },
        importance: 0.5,
      });
      upsertEdge(db, {
        source_id: workspaceId,
        target_id: fileId,
        rel_type: 'CONTAINS',
        weight: 1.0,
        properties: {},
      });
      result.fileNodeAdded = true;

      // Chunk the file
      const chunks = await chunkFile(filePath);

      for (const chunk of chunks) {
        const skeleton = skeletonToString(chunk);
        const body = redactSecrets(chunk.fullBody);
        const textToEmbed = `${chunk.name ?? ''} ${skeleton}`.trim();
        const embedding = await embed(textToEmbed);
        const tokenCount = countTokens(skeleton);

        const chunkId = `chunk:${filePath}:${chunk.startLine}`;
        upsertNode(db, {
          id: chunkId,
          type: 'chunk',
          properties: {
            filePath,
            relPath,
            language: chunk.language,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            chunkType: chunk.chunkType,
            name: chunk.name,
            skeleton,
            fullBody: body,
            token_count: tokenCount,
            confidence: chunk.confidence,
          },
          embedding,
          importance: 0.5,
        });

        insertVec(db, chunkId, embedding);

        upsertEdge(db, {
          source_id: fileId,
          target_id: chunkId,
          rel_type: 'CONTAINS',
          weight: 1.0,
          properties: {},
        });

        result.chunksAdded++;
      }
    } catch {
      // Skip files that fail to parse
    }

    return result;
  });

  // Aggregate results
  for (const result of fileResults) {
    if (result.fileNodeAdded) nodeCount++;
    chunkCount += result.chunksAdded;
    nodeCount += result.chunksAdded;
  }

  return {
    node_count: nodeCount,
    chunk_count: chunkCount,
    file_count: files.length,
    duration_ms: Date.now() - start,
  };
}

function walkDir(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv']);

  function recurse(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) recurse(path.join(current, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) results.push(path.join(current, entry.name));
      }
    }
  }

  recurse(dir);
  return results;
}

export async function handleIndexProject(params: Record<string, unknown>) {
  const result = await indexProject({
    path: String(params['path'] ?? '.'),
    languages: Array.isArray(params['languages']) ? params['languages'] as string[] : undefined,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result),
    }],
  };
}
