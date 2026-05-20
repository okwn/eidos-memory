import diff from 'fast-diff';

export interface DiffResult {
  hasChanges: boolean;
  added: number;
  removed: number;
  diffText: string;
  tokenEstimate: number;
}

export function computeDiff(oldText: string, newText: string): DiffResult {
  if (oldText === newText) {
    return { hasChanges: false, added: 0, removed: 0, diffText: '', tokenEstimate: 0 };
  }

  const changes = diff(oldText, newText);
  const lines: string[] = [];
  let added = 0;
  let removed = 0;

  for (const [op, text] of changes) {
    if (op === 1) {
      // insertion
      for (const line of text.split('\n')) {
        if (line.trim()) {
          lines.push(`+ ${line}`);
          added++;
        }
      }
    } else if (op === -1) {
      // deletion
      for (const line of text.split('\n')) {
        if (line.trim()) {
          lines.push(`- ${line}`);
          removed++;
        }
      }
    }
  }

  const diffText = lines.slice(0, 50).join('\n'); // cap at 50 lines to keep tokens low
  const tokenEstimate = Math.ceil(diffText.split(/\s+/).length * 1.3);

  return { hasChanges: true, added, removed, diffText, tokenEstimate };
}
