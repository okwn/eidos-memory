/* Eidos Memory — Content Script
   Detects AI chat input fields, intercepts submission,
   enriches prompts via the local EidosCore daemon, and replaces input text. */

(function () {
  'use strict';

  // ── Site-specific selectors ──────────────────────────────────────────────
  const SITE_SELECTORS = {
    'chat.openai.com': [
      '#prompt-textarea',
      'div[id="prompt-textarea"]',
      'textarea[data-id="root"]',
    ],
    'claude.ai': [
      'div[contenteditable="true"]',
      'div.ProseMirror',
      '[role="textbox"]',
    ],
    'gemini.google.com': [
      'div[contenteditable="true"]',
      '.ql-editor',
      'rich-textarea .text-input-field',
    ],
    'perplexity.ai': [
      'textarea',
      'div[contenteditable="true"]',
    ],
    'phind.com': [
      'textarea',
      'div[contenteditable="true"]',
      '.CodeMirror textarea',
    ],
  };

  const FALLBACK_SELECTORS = [
    '#prompt-textarea',
    'div[contenteditable="true"]',
    'textarea',
    '[role="textbox"]',
    '.chat-input',
    '[data-testid*="input"]',
    '[data-testid*="prompt"]',
  ];

  // ── State ────────────────────────────────────────────────────────────────
  let isEnabled = true;
  let enrichmentInProgress = false;
  let totalTokensSaved = 0;

  // Load enabled state
  chrome.storage.local.get(['enabled'], (result) => {
    isEnabled = result.enabled !== false; // default: true
  });

  // Listen for toggle from popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      isEnabled = changes.enabled.newValue;
      updateBadge();
    }
  });

  // ── Find the active chat input ───────────────────────────────────────────
  function getChatInput() {
    const hostname = window.location.hostname;
    const selectors = SITE_SELECTORS[hostname] || FALLBACK_SELECTORS;

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }

    // Deep fallback: any focused contenteditable or textarea
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return active;
    }

    return null;
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  // ── Get text from input ──────────────────────────────────────────────────
  function getInputText(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value;
    }
    return el.innerText || el.textContent || '';
  }

  // ── Set text in input (preserving React/framework state) ─────────────────
  function setInputText(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Native input — use native setter to trigger React events
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      // ContentEditable — use execCommand for undo support
      el.focus();
      el.innerHTML = '';
      document.execCommand('insertText', false, text);
    }
  }

  // ── Show status indicator ────────────────────────────────────────────────
  function showIndicator(message, type = 'loading') {
    removeIndicator();

    const indicator = document.createElement('div');
    indicator.id = 'eidos-memory-indicator';
    indicator.className = `eidos-indicator eidos-${type}`;
    indicator.textContent = message;

    document.body.appendChild(indicator);

    // Auto-remove after 3s for success/error, keep for loading
    if (type !== 'loading') {
      setTimeout(removeIndicator, 3000);
    }
  }

  function removeIndicator() {
    const existing = document.getElementById('eidos-memory-indicator');
    if (existing) existing.remove();
  }

  // ── Intercept Enter key ──────────────────────────────────────────────────
  document.addEventListener('keydown', async (e) => {
    // Only intercept plain Enter (not Shift+Enter, Ctrl+Enter, etc.)
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

    if (!isEnabled) return;
    if (enrichmentInProgress) return;

    const input = getChatInput();
    if (!input) return;

    const query = getInputText(input).trim();
    if (!query || query.length < 10) return; // skip very short inputs

    // Check if already enriched (avoid double-enrichment)
    if (query.startsWith('[CODE CONTEXT]') || query.startsWith('[MEMORY]')) return;

    e.preventDefault();
    e.stopPropagation();

    enrichmentInProgress = true;
    showIndicator('Enriching with Eidos Memory...', 'loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'enrichPrompt',
        query,
        url: window.location.href,
      });

      if (response && response.enriched && response.enriched !== query) {
        setInputText(input, response.enriched);
        totalTokensSaved += response.tokensSaved || 0;
        showIndicator(`Enriched (+${response.tokensSaved || 0} tokens context)`, 'success');
      } else {
        showIndicator('No relevant context found', 'info');
      }
    } catch (err) {
      showIndicator('Eidos daemon not reachable', 'error');
    } finally {
      enrichmentInProgress = false;

      // Submit the form / trigger Enter after a brief delay
      setTimeout(() => {
        removeIndicator();
        submitInput(input);
      }, 300);
    }
  }, true); // useCapture to intercept before site handlers

  // ── Trigger submission on the chat input ─────────────────────────────────
  function submitInput(input) {
    // Try to find and click the submit button first
    const hostname = window.location.hostname;

    const submitSelectors = {
      'chat.openai.com': ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]'],
      'claude.ai': ['button[aria-label="Send Message"]', 'button[type="submit"]'],
      'gemini.google.com': ['button.send-button', '.send-button-container button'],
      'perplexity.ai': ['button[aria-label="Submit"]', 'button[type="submit"]'],
      'phind.com': ['button[type="submit"]', '.search-bar__submit'],
    };

    const selectors = submitSelectors[hostname] || ['button[type="submit"]'];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.click();
        return;
      }
    }

    // Fallback: re-dispatch Enter key
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
    }));
  }

  // ── Badge update ─────────────────────────────────────────────────────────
  function updateBadge() {
    chrome.runtime.sendMessage({
      type: 'updateBadge',
      enabled: isEnabled,
    }).catch(() => {});
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  updateBadge();

  // Notify background that content script is loaded
  chrome.runtime.sendMessage({ type: 'contentScriptReady', url: window.location.href }).catch(() => {});
})();
