export type SummariserBackend = 'local' | `ollama:${string}` | `openai:${string}`;

export interface SummariseOptions {
  maxTokens?: number;
  style?: 'micro' | 'meso' | 'full';
}

export async function summarise(
  text: string,
  backend: SummariserBackend = 'local',
  opts: SummariseOptions = {},
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 120;
  const style     = opts.style ?? 'micro';

  if (backend === 'local') {
    return localSummarise(text, maxTokens, style);
  }
  if (backend.startsWith('ollama:')) {
    const model = backend.slice('ollama:'.length);
    return ollamaSummarise(text, model, maxTokens, style);
  }
  if (backend.startsWith('openai:')) {
    const model = backend.slice('openai:'.length);
    return openaiSummarise(text, model, maxTokens, style);
  }
  return localSummarise(text, maxTokens, style);
}

// ─── Local (smart heuristic, zero LLM) ───────────────────────────────────────

const KEYWORD_RE = /(error|fix|bug|crash|decided|changed|must|should|always|never|warning|todo|issue|fail|important|note)/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 8);
}

function localSummarise(text: string, maxTokens: number, style: string): string {
  const charBudget = maxTokens * 4; // rough 4 chars/token

  if (style === 'micro') {
    // Smart pick: first sentence, plus any high-signal keyword sentence, truncated
    const sentences = splitSentences(text);
    if (sentences.length <= 2) return text.slice(0, charBudget);

    const selected: string[] = [sentences[0]!];
    const keywordSentence = sentences.slice(1).find(s => KEYWORD_RE.test(s));
    if (keywordSentence) selected.push(keywordSentence);

    return selected.join(' ').slice(0, charBudget);
  }

  if (style === 'meso') {
    // First + longest + one keyword sentence (captures gist + detail + action)
    const sentences = splitSentences(text);
    if (sentences.length <= 3) return text.slice(0, charBudget);

    const selected: string[] = [sentences[0]!];
    const longest = sentences.slice(1).reduce((a, b) => a.length >= b.length ? a : b);
    if (longest !== sentences[0]) selected.push(longest);
    const keywordSentence = sentences.find(s => KEYWORD_RE.test(s) && !selected.includes(s));
    if (keywordSentence) selected.push(keywordSentence);

    return selected.join(' ').slice(0, charBudget);
  }

  // full: greedy line packing
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let result = '';
  for (const line of lines) {
    if (result.length + line.length > charBudget) break;
    result += line + '\n';
  }
  return result.trim();
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

async function ollamaSummarise(
  text: string,
  model: string,
  maxTokens: number,
  style: string,
): Promise<string> {
  const prompt = buildPrompt(text, style, maxTokens);
  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: maxTokens } }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as { response?: string };
    return (data.response ?? '').trim() || localSummarise(text, maxTokens, style);
  } catch {
    return localSummarise(text, maxTokens, style);
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function openaiSummarise(
  text: string,
  model: string,
  maxTokens: number,
  style: string,
): Promise<string> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return localSummarise(text, maxTokens, style);

  const prompt = buildPrompt(text, style, maxTokens);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? localSummarise(text, maxTokens, style);
  } catch {
    return localSummarise(text, maxTokens, style);
  }
}

function buildPrompt(text: string, style: string, maxTokens: number): string {
  const styleDesc =
    style === 'micro'  ? `one sentence (under 20 words)` :
    style === 'meso'   ? `3-5 sentences` :
    `a concise paragraph`;

  return `Summarise the following in ${styleDesc}, max ${maxTokens} tokens:\n\n${text.slice(0, 3000)}`;
}
