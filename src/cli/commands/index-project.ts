import path from 'path';
import { indexProject } from '../../mcp/tools/index_project.js';

export async function runIndexProject(dirPath: string, languages: string[], quiet = false): Promise<void> {
  const absPath = path.resolve(dirPath);
  if (!quiet) console.log(`[eidos] Indexing ${absPath} ...`);
  const result = await indexProject({ path: absPath, languages });
  if (!quiet) console.log(`[eidos] Done. Nodes: ${result.node_count}, Chunks: ${result.chunk_count}, Time: ${result.duration_ms}ms`);
}
