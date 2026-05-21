// Eidos Memory — Background Service Worker
// Relays enrichment requests from content scripts to the local EidosCore daemon.

const EIDOS_DASH_URL = 'http://localhost:7842';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'enrichPrompt') {
    enrichPrompt(request.query, request.url)
      .then(sendResponse)
      .catch(() => sendResponse({ enriched: request.query, tokensSaved: 0 }));
    return true; // keep channel open for async response
  }

  if (request.type === 'checkDaemon') {
    checkDaemon()
      .then(sendResponse)
      .catch(() => sendResponse({ running: false }));
    return true;
  }

  if (request.type === 'getStats') {
    fetchStats()
      .then(sendResponse)
      .catch(() => sendResponse({ tokensSaved: 0, dollarsSaved: 0, promptsWrapped: 0 }));
    return true;
  }
});

async function enrichPrompt(query, url) {
  const { enabled = true, budget = 2000, siteOverrides = {} } = await chrome.storage.local.get(['enabled', 'budget', 'siteOverrides']);

  if (!enabled) {
    return { enriched: query, tokensSaved: 0, skipped: true };
  }

  // Check site-specific override
  const hostname = new URL(url).hostname;
  if (siteOverrides[hostname] === false) {
    return { enriched: query, tokensSaved: 0, skipped: true };
  }

  try {
    const resp = await fetch(`${EIDOS_DASH_URL}/api/assemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, budget }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    return {
      enriched: data.context || query,
      tokensSaved: data.tokensSaved || 0,
      tokens: data.tokens || 0,
    };
  } catch (err) {
    // Daemon not running or error — pass through original query
    return { enriched: query, tokensSaved: 0, error: err.message };
  }
}

async function checkDaemon() {
  try {
    const resp = await fetch(`${EIDOS_DASH_URL}/api/mcp-status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch {
    return { running: false, connected: false, alive: false };
  }
}

async function fetchStats() {
  try {
    const resp = await fetch(`${EIDOS_DASH_URL}/api/stats`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return {
      tokensSaved: data.tokensSaved || 0,
      dollarsSaved: data.dollarsSaved || 0,
      promptsWrapped: data.promptsWrapped || 0,
      totalNodes: data.totalNodes || 0,
    };
  } catch {
    return { tokensSaved: 0, dollarsSaved: 0, promptsWrapped: 0, totalNodes: 0 };
  }
}
