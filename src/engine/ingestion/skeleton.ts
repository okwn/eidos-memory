import type { CodeChunk } from './chunker.js';
import { redactSecrets } from '../privacy.js';

export interface Skeleton {
  signature: string;
  calls: string[];
  throws: string[];
  depends: string[];
  complexity: string;
  confidence: 'high' | 'low';
  tokenEstimate: number;
}

const CALL_PATTERN = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
const THROW_PATTERN_PY    = /\braise\s+([A-Z][a-zA-Z0-9_]*)/g;
const THROW_PATTERN_JS    = /\bthrow\s+new\s+([A-Z][a-zA-Z0-9_]*)/g;
const IMPORT_PATTERN_PY   = /^(?:from|import)\s+([a-zA-Z0-9_.]+)/gm;
const IMPORT_PATTERN_JS   = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;

const BUILTINS = new Set([
  'if','else','for','while','return','function','class','const','let','var',
  'async','await','try','catch','new','throw','import','export','from','this',
  'super','switch','case','break','continue','print','len','range','str','int',
  'float','bool','list','dict','set','tuple','None','True','False','undefined',
  'null','void','console','process','Object','Array','Promise','Error','Map','Set',
]);

export function generateSkeleton(chunk: CodeChunk): Skeleton {
  const body = redactSecrets(chunk.fullBody);
  const lines = body.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  const calls = extractCalls(body);
  const throws = extractThrows(body, chunk.language);
  const depends = extractDepends(body, chunk.language);
  const complexity = estimateComplexity(body);
  const signature = extractSignature(firstLine, chunk.name, chunk.chunkType);

  const skeletonText = formatSkeleton({ signature, calls, throws, depends, complexity, confidence: chunk.confidence, tokenEstimate: 0 });
  const tokenEstimate = Math.ceil(skeletonText.split(/\s+/).length * 1.3);

  return { signature, calls, throws, depends, complexity, confidence: chunk.confidence, tokenEstimate };
}

function extractSignature(firstLine: string, name?: string, chunkType?: string): string {
  // Clean up the first line to just the signature
  const cleaned = firstLine
    .replace(/\s*:\s*$/, '')       // remove trailing colon (Python)
    .replace(/\s*\{\s*$/, '')      // remove trailing brace (JS/TS/Go/Rust)
    .replace(/\s*;$/, '')          // remove semicolon
    .trim();
  if (cleaned.length > 0 && cleaned.length < 150) return cleaned;
  return `${chunkType ?? 'fn'} ${name ?? '<anonymous>'}(...)`;
}

function extractCalls(body: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const pat = new RegExp(CALL_PATTERN.source, 'g');
  while ((m = pat.exec(body)) !== null) {
    const name = m[1];
    if (name && !BUILTINS.has(name) && name.length > 1) found.add(name);
  }
  return [...found].slice(0, 8);
}

function extractThrows(body: string, language: string): string[] {
  const found = new Set<string>();
  const pattern = language === 'python' ? THROW_PATTERN_PY : THROW_PATTERN_JS;
  const pat = new RegExp(pattern.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = pat.exec(body)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  return [...found].slice(0, 4);
}

function extractDepends(body: string, language: string): string[] {
  const found = new Set<string>();
  const pattern = language === 'python' ? IMPORT_PATTERN_PY : IMPORT_PATTERN_JS;
  const pat = new RegExp(pattern.source, 'gm');
  let m: RegExpExecArray | null;
  while ((m = pat.exec(body)) !== null) {
    if (m[1]) {
      const mod = m[1].split('/')[0].split('.')[0];
      if (mod) found.add(mod);
    }
  }
  return [...found].slice(0, 6);
}

function estimateComplexity(body: string): string {
  const loops = (body.match(/\b(for|while|forEach|map|filter|reduce)\b/g) ?? []).length;
  const conditions = (body.match(/\b(if|else if|elif|switch|case|ternary|\?\s*:)\b/g) ?? []).length;
  const total = loops + conditions;
  if (total <= 2) return 'O(1) or simple';
  if (total <= 5) return 'O(n) moderate';
  return 'O(n²) or complex';
}

export function formatSkeleton(sk: Skeleton): string {
  const parts: string[] = [sk.signature];
  if (sk.calls.length > 0)   parts.push(`  Calls: ${sk.calls.join(', ')}`);
  if (sk.throws.length > 0)  parts.push(`  Throws: ${sk.throws.join(', ')}`);
  if (sk.depends.length > 0) parts.push(`  Depends: ${sk.depends.join(', ')}`);
  parts.push(`  Complexity: ${sk.complexity}`);
  parts.push(`  Confidence: ${sk.confidence}`);
  return parts.join('\n');
}

export function skeletonToString(chunk: CodeChunk): string {
  const sk = generateSkeleton(chunk);
  return formatSkeleton(sk);
}
