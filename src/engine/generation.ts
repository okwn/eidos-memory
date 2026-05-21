import { summarise, SummariserBackend } from './summariser/index.js';
import { stripPrivateTags } from './privacy.js';

export interface GeneratedObservation {
  title: string;
  type: 'decision' | 'fact' | 'narrative' | 'concept' | 'code';
  narrative: string;
  facts: string[];
  concepts: string[];
  files_read: string[];
  files_modified: string[];
}

export interface GeneratedSummary {
  user_requests: string;
  investigations: string;
  learnings: string;
  completed_tasks: string;
  next_steps: string;
}

/**
 * Generate structured observations from a conversation session.
 * Uses LLM if available (Ollama/OpenAI), falls back to local heuristics.
 */
export async function generateObservations(
  conversation: Array<{ role: string; content: string }>,
  backend: SummariserBackend = 'local',
): Promise<GeneratedObservation[]> {
  // Strip private tags from all content
  const cleanConversation = conversation.map((t) => ({
    ...t,
    content: stripPrivateTags(t.content),
  })).filter((t) => t.content.length > 0);

  if (cleanConversation.length === 0) return [];

  if (backend === 'local') {
    return localExtractObservations(cleanConversation);
  }

  // For LLM backends, build a structured extraction prompt
  const prompt = buildExtractionPrompt(cleanConversation);
  try {
    const response = await summarise(prompt, backend, { maxTokens: 500, style: 'full' });
    return parseObservations(response);
  } catch {
    return localExtractObservations(cleanConversation);
  }
}

/**
 * Generate a session summary from conversation data.
 */
export async function generateSessionSummary(
  conversation: Array<{ role: string; content: string }>,
  backend: SummariserBackend = 'local',
): Promise<GeneratedSummary> {
  const cleanConversation = conversation.map((t) => ({
    ...t,
    content: stripPrivateTags(t.content),
  })).filter((t) => t.content.length > 0);

  if (cleanConversation.length === 0) {
    return { user_requests: '', investigations: '', learnings: '', completed_tasks: '', next_steps: '' };
  }

  if (backend === 'local') {
    return localExtractSummary(cleanConversation);
  }

  const prompt = buildSummaryPrompt(cleanConversation);
  try {
    const response = await summarise(prompt, backend, { maxTokens: 300, style: 'full' });
    return parseSummary(response);
  } catch {
    return localExtractSummary(cleanConversation);
  }
}

// ── Local heuristic extraction ─────────────────────────────────────────────

function localExtractObservations(
  conversation: Array<{ role: string; content: string }>,
): GeneratedObservation[] {
  const observations: GeneratedObservation[] = [];

  // Extract decisions (keywords: decided, chose, use, prefer)
  const decisionPattern = /(?:decided|chose|use|prefer|going with|picked|selected)\s+(.{10,80})/gi;
  for (const turn of conversation) {
    if (turn.role !== 'assistant') continue;
    let match;
    while ((match = decisionPattern.exec(turn.content)) !== null) {
      observations.push({
        title: match[1]!.trim().slice(0, 80),
        type: 'decision',
        narrative: match[0].trim(),
        facts: [],
        concepts: extractConcepts(match[0]),
        files_read: extractFiles(turn.content),
        files_modified: [],
      });
    }
  }

  // Extract code changes (look for file paths and code blocks)
  const filePattern = /(?:modified|created|edited|updated|changed|wrote)\s+[`"]?([^\s`"]+\.[a-z]{1,5})/gi;
  for (const turn of conversation) {
    if (turn.role !== 'assistant') continue;
    let match;
    while ((match = filePattern.exec(turn.content)) !== null) {
      observations.push({
        title: `Modified ${match[1]}`,
        type: 'code',
        narrative: turn.content.slice(0, 200),
        facts: [],
        concepts: extractConcepts(turn.content),
        files_read: [],
        files_modified: [match[1]!],
      });
    }
  }

  // Extract bugs/errors
  const bugPattern = /(?:bug|error|issue|problem|crash|fail)\s*[:\-]?\s*(.{10,80})/gi;
  for (const turn of conversation) {
    if (turn.role !== 'assistant') continue;
    let match;
    while ((match = bugPattern.exec(turn.content)) !== null) {
      observations.push({
        title: match[1]!.trim().slice(0, 80),
        type: 'fact',
        narrative: match[0].trim(),
        facts: [],
        concepts: extractConcepts(match[0]),
        files_read: extractFiles(turn.content),
        files_modified: [],
      });
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return observations.filter((o) => {
    const key = o.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function localExtractSummary(
  conversation: Array<{ role: string; content: string }>,
): GeneratedSummary {
  const userTurns = conversation.filter((t) => t.role === 'user').map((t) => t.content);
  const assistantTurns = conversation.filter((t) => t.role === 'assistant').map((t) => t.content);

  const userRequests = userTurns.slice(0, 3).join('; ').slice(0, 200);
  const learnings = assistantTurns
    .filter((t) => /(?:found|discovered|learned|realized|shows|indicates)/i.test(t))
    .map((t) => t.split(/[.!?]/)[0]?.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('; ')
    .slice(0, 200);

  const completed = assistantTurns
    .filter((t) => /(?:fixed|completed|done|implemented|added|created|wrote)/i.test(t))
    .map((t) => t.split(/[.!?]/)[0]?.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('; ')
    .slice(0, 200);

  return {
    user_requests: userRequests,
    investigations: '',
    learnings,
    completed_tasks: completed,
    next_steps: '',
  };
}

// ── LLM prompt builders ────────────────────────────────────────────────────

function buildExtractionPrompt(conversation: Array<{ role: string; content: string }>): string {
  const transcript = conversation.slice(-10).map((t) => `${t.role}: ${t.content.slice(0, 200)}`).join('\n');
  return `Extract structured observations from this conversation. For each observation, provide:
- title: short description (max 80 chars)
- type: one of "decision", "fact", "narrative", "concept", "code"
- narrative: detailed explanation
- facts: array of key facts
- concepts: array of concepts mentioned
- files_modified: array of files changed

Conversation:
${transcript}

Respond as JSON array of observations.`;
}

function buildSummaryPrompt(conversation: Array<{ role: string; content: string }>): string {
  const transcript = conversation.slice(-10).map((t) => `${t.role}: ${t.content.slice(0, 200)}`).join('\n');
  return `Summarize this conversation session:
- user_requests: what the user wanted
- investigations: what was explored
- learnings: what was discovered
- completed_tasks: what was done
- next_steps: what to do next

Conversation:
${transcript}

Respond as JSON object.`;
}

// ── Parsers ────────────────────────────────────────────────────────────────

function parseObservations(response: string): GeneratedObservation[] {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as GeneratedObservation[];
    }
  } catch { /* fall through */ }
  return [];
}

function parseSummary(response: string): GeneratedSummary {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as GeneratedSummary;
    }
  } catch { /* fall through */ }
  return { user_requests: '', investigations: '', learnings: '', completed_tasks: '', next_steps: '' };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function extractConcepts(text: string): string[] {
  const concepts: string[] = [];
  const patterns = [
    /\b(JWT|OAuth|REST|GraphQL|API|SDK|CLI|MCP|SQL|HTTP|HTTPS|WebSocket)\b/gi,
    /\b(React|Vue|Angular|Node|Express|Django|Flask|FastAPI)\b/gi,
    /\b(TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+)\b/gi,
    /\b(Docker|Kubernetes|AWS|GCP|Azure|Redis|PostgreSQL|MongoDB)\b/gi,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      if (!concepts.includes(m[1]!)) concepts.push(m[1]!);
    }
  }
  return concepts.slice(0, 5);
}

function extractFiles(text: string): string[] {
  const files: string[] = [];
  const pattern = /[\w/\\.-]+\.(ts|js|py|rs|go|java|cpp|c|h|html|css|json|yaml|yml|md|sql|sh)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (!files.includes(m[0])) files.push(m[0]);
  }
  return files.slice(0, 5);
}
