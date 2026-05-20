import { countTokens } from '../../engine/tokens.js';
import { redactSecrets } from '../../engine/privacy.js';

function skeletonCompress(text: string): string {
  const lines = text.split('\n');
  const sig = lines[0]?.trim() ?? '';
  const calls = lines.filter((l) => l.includes('(')).slice(0, 3).map((l) => l.trim()).join(', ');
  return `${sig}\n  [compressed: ${lines.length} lines → summary]${calls ? `\n  Calls: ${calls}` : ''}`;
}

function summaryCompress(text: string): string {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const key = sentences.slice(0, 3).map((s) => s.trim()).join('. ');
  return key + (sentences.length > 3 ? ` [+${sentences.length - 3} more]` : '');
}

export async function handleCompressText(params: Record<string, unknown>) {
  const text = String(params['text'] ?? '');
  const mode = String(params['mode'] ?? 'summary');

  const sanitized = redactSecrets(text);
  const originalTokens = countTokens(sanitized);

  let compressed: string;
  switch (mode) {
    case 'skeleton':
      compressed = skeletonCompress(sanitized);
      break;
    case 'summary':
      compressed = summaryCompress(sanitized);
      break;
    case 'diff':
      compressed = sanitized.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).slice(0, 30).join('\n');
      break;
    default:
      compressed = summaryCompress(sanitized);
  }

  const compressedTokens = countTokens(compressed);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        compressed,
        original_tokens: originalTokens,
        compressed_tokens: compressedTokens,
        reduction_pct: Math.round((1 - compressedTokens / Math.max(1, originalTokens)) * 100),
      }),
    }],
  };
}
