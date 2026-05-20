import os from 'os';
import fs from 'fs';
import path from 'path';
import { cosineSimilarity } from '../store/vector.js';

// Force persistent model cache at ~/.eidos/models — set BEFORE any import of @xenova/transformers
const EIDOS_MODEL_CACHE = path.join(os.homedir(), '.eidos', 'models');
process.env['TRANSFORMERS_CACHE'] = EIDOS_MODEL_CACHE;
process.env['XDG_CACHE_HOME']      = EIDOS_MODEL_CACHE; // xenova fallback
fs.mkdirSync(EIDOS_MODEL_CACHE, { recursive: true });

// Lazy-loaded pipeline singleton
let _pipeline: PipelineType | null = null;
let _loading = false;
let _loadPromise: Promise<PipelineType> | null = null;

// Type shim for @xenova/transformers (loaded dynamically)
type PipelineType = {
  (texts: string | string[], opts?: Record<string, unknown>): Promise<{ data: Float32Array; dims: number[] }[]>;
};

// Supported models:
//   default  → Xenova/all-MiniLM-L6-v2  (384-dim, ~22 MB, fast)
//   bge-base → Xenova/bge-base-en-v1.5  (768-dim, ~90 MB, higher quality for code)
const SUPPORTED_MODELS: Record<string, { hfId: string; dims: number; sizeMb: number }> = {
  'minilm':   { hfId: 'Xenova/all-MiniLM-L6-v2',  dims: 384, sizeMb: 22  },
  'bge-base': { hfId: 'Xenova/bge-base-en-v1.5',   dims: 768, sizeMb: 90  },
};

function resolveModelName(): string {
  const key = process.env['EIDOS_EMBEDDING_MODEL'] ?? 'minilm';
  return SUPPORTED_MODELS[key]?.hfId ?? SUPPORTED_MODELS['minilm']!.hfId;
}

const MODEL_NAME = resolveModelName();

function renderProgress(loaded: number, total: number, file: string): void {
  if (!process.stderr.isTTY) return;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  const mb = (loaded / 1024 / 1024).toFixed(1);
  const name = file.length > 30 ? '...' + file.slice(-27) : file.padEnd(30);
  process.stderr.write(`\r  \x1b[36m⬇\x1b[0m  ${name}  [${bar}] ${pct}%  ${mb} MB   `);
}

async function getPipeline(): Promise<PipelineType> {
  if (_pipeline) return _pipeline;
  if (_loadPromise) return _loadPromise;

  _loading = true;
  _loadPromise = (async () => {
    let pipeline, env;
    try {
      const mod = await import('@xenova/transformers');
      pipeline = mod.pipeline;
      env = mod.env;
    } catch (err) {
      console.error(`\n\x1b[31m[eidos] Failed to load embedding model: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
      console.error(`\x1b[31m[eidos] Make sure @xenova/transformers is installed. Run: npm install @xenova/transformers\x1b[0m`);
      _loading = false;
      throw err;
    }

    // Confirm cache dir on env (set at module load, re-affirm here)
    env.cacheDir = EIDOS_MODEL_CACHE;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).allowLocalModels = true;

    let lastFile = '';
    // Check if already cached (look for any MiniLM dir inside cache)
    const isCached = fs.existsSync(EIDOS_MODEL_CACHE) &&
      fs.readdirSync(EIDOS_MODEL_CACHE).some(f => f.toLowerCase().includes('minilm'));

    if (!isCached) {
      process.stderr.write(`\n\x1b[36m[eidos]\x1b[0m Downloading embedding model (all-MiniLM-L6-v2, ~22 MB)...\n`);
    }

    let pipe;
    try {
      pipe = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (progress: any) => {
          if (progress?.status === 'downloading' && progress?.file) {
            if (progress.file !== lastFile) {
              if (lastFile) process.stderr.write('\n');
              lastFile = progress.file;
            }
            renderProgress(progress.loaded ?? 0, progress.total ?? 0, progress.file);
          }
          if (progress?.status === 'ready' && lastFile) {
            process.stderr.write('\n');
            lastFile = '';
          }
        },
      });
    } catch (err) {
      console.error(`\n\x1b[31m[eidos] Failed to load or download the embedding model.\x1b[0m`);
      console.error(`\x1b[31m[eidos] ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
      _loading = false;
      throw err;
    }

    if (!isCached) process.stderr.write(`\x1b[32m[eidos]\x1b[0m Embedding model ready.\n`);
    _pipeline = pipe as unknown as PipelineType;
    _loading = false;
    return _pipeline;
  })();

  return _loadPromise;
}

export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  // @xenova/transformers returns an array; take first element's data
  const data = (output as unknown as { data: Float32Array }[])[0]?.data ?? (output as unknown as { data: Float32Array }).data;
  return new Float32Array(data);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getPipeline();
  const output = await pipe(texts, { pooling: 'mean', normalize: true });
  const arr = output as unknown as { data: Float32Array }[];
  return arr.map((o) => new Float32Array(o.data));
}

export { cosineSimilarity };

export function isModelLoading(): boolean {
  return _loading;
}

export function isModelCached(): boolean {
  return fs.existsSync(EIDOS_MODEL_CACHE) &&
    fs.readdirSync(EIDOS_MODEL_CACHE).some(f => f.toLowerCase().includes('minilm'));
}

export function getModelCacheDir(): string {
  return EIDOS_MODEL_CACHE;
}

export function getActiveModelName(): string {
  return MODEL_NAME;
}

export { SUPPORTED_MODELS };
