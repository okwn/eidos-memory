import { getEncoding as _getEncoding } from 'js-tiktoken';

let _enc: ReturnType<typeof _getEncoding> | null = null;

function getEncoding(): ReturnType<typeof _getEncoding> {
  if (!_enc) {
    _enc = _getEncoding('cl100k_base');
  }
  return _enc;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    const enc = getEncoding();
    return enc.encode(text).length;
  } catch {
    // Fallback: rough approximation (1 token ≈ 4 chars)
    return Math.ceil(text.length / 4);
  }
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (countTokens(text) <= maxTokens) return text;
  // Binary search for cut point
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (countTokens(text.slice(0, mid)) <= maxTokens) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, lo - 1);
}
