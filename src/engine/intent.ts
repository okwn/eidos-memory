import { embed, cosineSimilarity } from './embedding.js';

export type IntentClass =
  | 'code_impl'
  | 'debugging'
  | 'decision_recall'
  | 'recap'
  | 'explanation';

export interface IntentResult {
  intent: IntentClass;
  confidence: number;
  scores: Record<IntentClass, number>;
}

// Prototype sentences for each intent class (few-shot centroids)
const INTENT_PROTOTYPES: Record<IntentClass, string[]> = {
  code_impl: [
    'implement the function',
    'write the code for',
    'add a new feature',
    'create a method that',
    'build the module',
    'refactor this to',
    'update the implementation',
  ],
  debugging: [
    'why is this failing',
    'fix this bug',
    'error in the code',
    'exception thrown',
    'not working correctly',
    'debug this issue',
    'stack trace shows',
    'TypeError undefined',
  ],
  decision_recall: [
    'what did we decide',
    'which approach did we choose',
    'recall the architecture decision',
    'why did we pick',
    'what was the rationale',
    'remind me of the decision',
  ],
  recap: [
    'summarize what we did',
    'what happened in this session',
    'give me a summary',
    'recap the conversation',
    'what changes were made',
    'what have we done so far',
  ],
  explanation: [
    'explain how this works',
    'what does this function do',
    'describe the architecture',
    'how does the system handle',
    'walk me through',
    'what is the purpose of',
  ],
};

// Cache for prototype embeddings (loaded once)
let _centroids: Map<IntentClass, Float32Array> | null = null;
let _loading = false;
let _loadPromise: Promise<Map<IntentClass, Float32Array>> | null = null;

async function getCentroids(): Promise<Map<IntentClass, Float32Array>> {
  if (_centroids) return _centroids;
  if (_loadPromise) return _loadPromise;

  _loading = true;
  _loadPromise = (async () => {
    const centroids = new Map<IntentClass, Float32Array>();
    for (const [cls, sentences] of Object.entries(INTENT_PROTOTYPES)) {
      // Embed all prototype sentences and average them into a centroid
      const embeddings = await Promise.all(sentences.map((s) => embed(s)));
      const dim = embeddings[0]!.length;
      const centroid = new Float32Array(dim);
      for (const emb of embeddings) {
        for (let i = 0; i < dim; i++) centroid[i] += emb[i];
      }
      for (let i = 0; i < dim; i++) centroid[i] /= embeddings.length;
      // Normalize
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += centroid[i] * centroid[i];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let i = 0; i < dim; i++) centroid[i] /= norm;
      centroids.set(cls as IntentClass, centroid);
    }
    _centroids = centroids;
    _loading = false;
    return centroids;
  })();

  return _loadPromise;
}

export async function classifyIntent(query: string): Promise<IntentResult> {
  const [queryEmbed, centroids] = await Promise.all([embed(query), getCentroids()]);

  const scores = {} as Record<IntentClass, number>;
  for (const [cls, centroid] of centroids.entries()) {
    scores[cls] = cosineSimilarity(queryEmbed, centroid);
  }

  // Softmax-style normalization for confidence
  const values = Object.values(scores);
  const maxScore = Math.max(...values);
  const expSum = values.reduce((s, v) => s + Math.exp(v - maxScore), 0);
  const softmax = values.map((v) => Math.exp(v - maxScore) / expSum);

  const entries = Object.entries(scores) as [IntentClass, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const intent = entries[0]![0];
  const intentIdx = (Object.keys(INTENT_PROTOTYPES) as IntentClass[]).indexOf(intent);
  const confidence = softmax[intentIdx] ?? 0;

  return { intent, confidence, scores };
}

export function isCentroidsLoading(): boolean {
  return _loading;
}
