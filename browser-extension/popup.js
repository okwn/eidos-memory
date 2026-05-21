// Eidos Memory — Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggle-enabled');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statTokens = document.getElementById('stat-tokens');
  const statDollars = document.getElementById('stat-dollars');
  const statPrompts = document.getElementById('stat-prompts');
  const budgetSlider = document.getElementById('budget-slider');
  const budgetValue = document.getElementById('budget-value');
  const btnDashboard = document.getElementById('btn-dashboard');
  const btnIndex = document.getElementById('btn-index');

  // Load stored settings
  const { enabled = true, budget = 2000 } = await chrome.storage.local.get(['enabled', 'budget']);
  toggle.checked = enabled;
  budgetSlider.value = budget;
  budgetValue.textContent = `${budget} tokens`;

  // Toggle handler
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: toggle.checked });
  });

  // Budget slider handler
  budgetSlider.addEventListener('input', () => {
    const val = parseInt(budgetSlider.value, 10);
    budgetValue.textContent = `${val} tokens`;
    chrome.storage.local.set({ budget: val });
  });

  // Check daemon status
  try {
    const status = await chrome.runtime.sendMessage({ type: 'checkDaemon' });
    if (status.alive || status.connected) {
      statusDot.classList.add('connected');
      statusText.textContent = `Daemon running (PID ${status.pid || '?'})`;
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Daemon offline';
    }
  } catch {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Extension error';
  }

  // Fetch stats
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'getStats' });
    statTokens.textContent = formatNumber(stats.tokensSaved);
    statDollars.textContent = `$${stats.dollarsSaved.toFixed(2)}`;
    statPrompts.textContent = formatNumber(stats.promptsWrapped);
  } catch {
    // Stats unavailable
  }

  // Dashboard button
  btnDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:7842' });
  });

  // Index button (sends message to open terminal — informational only)
  btnIndex.addEventListener('click', async () => {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'checkDaemon' });
      if (status.alive) {
        // Open dashboard with index hint
        chrome.tabs.create({ url: 'http://localhost:7842#index' });
      } else {
        alert('EidosCore daemon is not running.\n\nStart it with: eidos daemon start');
      }
    } catch {
      alert('Could not connect to EidosCore daemon.\n\nStart it with: eidos daemon start');
    }
  });
});

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
