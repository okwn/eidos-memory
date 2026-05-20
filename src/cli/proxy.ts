import http from 'http';
import https from 'https';
import { URL } from 'url';
import { getDb } from '../store/db.js';
import { embed } from '../engine/embedding.js';
import { assembleContext } from '../engine/retrieval.js';
import { estimateBudget } from '../engine/budget.js';
import { countTokens } from '../engine/tokens.js';
import { listNodes } from '../store/nodes.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  [key: string]: unknown;
}

function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user' && typeof messages[i]!.content === 'string') {
      return messages[i]!.content as string;
    }
  }
  return '';
}

async function injectEidosContext(body: ChatCompletionRequest): Promise<ChatCompletionRequest> {
  const db = getDb();
  const query = extractLastUserQuery(body.messages);
  if (!query) return body;

  const config = { token_budget: 2000, adaptive_budget: true, model_cost_per_1k_tokens: 0.015 };
  const budgetEst = await estimateBudget(query, config);

  const essentials: Array<{ label: string; content: string }> = [];
  const turns = listNodes(db, 'conversation_turn', 6).slice(-3);
  for (const t of turns) {
    const p = t.properties as Record<string, unknown>;
    essentials.push({ label: String(p['role']), content: String(p['micro_summary'] ?? '') });
  }

  const queryEmbed = await embed(query);
  const result = await assembleContext(db, query, queryEmbed, null, budgetEst.budget, essentials);

  if (!result.contextString || result.tokens === 0) return body;

  const newMessages = [...body.messages];

  // Find existing system message or inject new one at position 0
  const sysIdx = newMessages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    newMessages[sysIdx] = {
      ...newMessages[sysIdx]!,
      content: `${result.contextString}\n\n${newMessages[sysIdx]!.content ?? ''}`,
    };
  } else {
    newMessages.unshift({ role: 'system', content: result.contextString });
  }

  // Validate alternation pattern (OpenAI requires user/assistant alternation after system)
  const validated = fixAlternation(newMessages);

  console.error(`[eidos-proxy] injected ${result.tokens} tokens (budget=${budgetEst.budget}, saved~${result.tokensSaved})`);

  return { ...body, messages: validated };
}

function fixAlternation(messages: ChatMessage[]): ChatMessage[] {
  // Remove consecutive same-role messages (except system at start and tool messages)
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'tool' || msg.role === 'function') {
      result.push(msg);
      continue;
    }
    const last = result.filter((m) => m.role !== 'system' && m.role !== 'tool' && m.role !== 'function').at(-1);
    if (last && last.role === msg.role) {
      // Merge content
      last.content = `${last.content ?? ''}\n${msg.content ?? ''}`.trim();
    } else {
      result.push({ ...msg });
    }
  }
  return result;
}

function proxyRequest(
  targetUrl: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqHeaders = { ...headers, host: url.hostname, 'content-length': String(body.length) };

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode ?? 200,
        headers: res.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function startProxy(port: number, upstream: string): Promise<void> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks);
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';

      // Only intercept chat completions POST
      if (method === 'POST' && url.includes('/chat/completions')) {
        try {
          const parsed = JSON.parse(rawBody.toString('utf-8')) as ChatCompletionRequest;
          const enriched = await injectEidosContext(parsed);
          const newBody = Buffer.from(JSON.stringify(enriched), 'utf-8');

          const forwardHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') forwardHeaders[k] = v;
          }
          forwardHeaders['content-type'] = 'application/json';
          forwardHeaders['content-length'] = String(newBody.length);

          const upstreamResp = await proxyRequest(`${upstream}${url}`, method, forwardHeaders, newBody);

          res.writeHead(upstreamResp.statusCode, upstreamResp.headers);
          res.end(upstreamResp.body);
        } catch (err) {
          console.error('[eidos-proxy] error:', err);
          // Fallback: pass through unmodified
          const forwardHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') forwardHeaders[k] = v;
          }
          try {
            const upstreamResp = await proxyRequest(`${upstream}${url}`, method, forwardHeaders, rawBody);
            res.writeHead(upstreamResp.statusCode, upstreamResp.headers);
            res.end(upstreamResp.body);
          } catch (e2) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        }
      } else {
        // Pass through all other requests unmodified
        const forwardHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') forwardHeaders[k] = v;
        }
        try {
          const upstreamResp = await proxyRequest(`${upstream}${url}`, method, forwardHeaders, rawBody);
          res.writeHead(upstreamResp.statusCode, upstreamResp.headers);
          res.end(upstreamResp.body);
        } catch {
          res.writeHead(502);
          res.end('Bad Gateway');
        }
      }
    });
  });

  server.listen(port, () => {
    console.log(`[eidos-proxy] Listening on http://localhost:${port} → ${upstream}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}
