import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

interface IgnoreInstance {
  add(patterns: string | string[]): this;
  ignores(path: string): boolean;
}

function createIgnore(): IgnoreInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = _require('ignore') as any;
  const factory: () => IgnoreInstance = typeof mod === 'function' ? mod : (mod.default ?? mod);
  return factory();
}

let _ig: IgnoreInstance | null = null;
let _workspaceRoot = '';

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'openai-key',    pattern: /sk-[A-Za-z0-9]{20,}/g,                replacement: '[REDACTED_API_KEY]' },
  { name: 'aws-key',       pattern: /AKIA[0-9A-Z]{16}/g,                    replacement: '[REDACTED_AWS_KEY]' },
  { name: 'github-token',  pattern: /ghp_[A-Za-z0-9]{36}/g,                 replacement: '[REDACTED_GH_TOKEN]' },
  { name: 'generic-token', pattern: /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-\.]{16,}["']?/gi, replacement: '[REDACTED_SECRET]' },
  { name: 'jwt',           pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: '[REDACTED_JWT]' },
  { name: 'hex-secret',    pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*[0-9a-fA-F]{32,}/gi, replacement: '[REDACTED_HEX_SECRET]' },
];

export function initPrivacyFirewall(workspaceRoot: string): void {
  _workspaceRoot = workspaceRoot;
  _ig = createIgnore();

  // Always ignore common sensitive paths
  _ig.add([
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    '.git/**',
    'node_modules/**',
    '*.secret',
    '.aws/**',
    '.ssh/**',
  ]);

  const eidosignorePath = path.join(workspaceRoot, '.eidosignore');
  if (fs.existsSync(eidosignorePath)) {
    const content = fs.readFileSync(eidosignorePath, 'utf-8');
    _ig.add(content);
  }
}

export function isFileAllowed(filePath: string): boolean {
  if (!_ig) return true;
  const relative = path.relative(_workspaceRoot, filePath).replace(/\\/g, '/');
  if (relative.startsWith('..')) return true; // outside workspace, allow
  return !_ig.ignores(relative);
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizeForLLM(text: string): string {
  return redactSecrets(text);
}
