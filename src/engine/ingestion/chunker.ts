import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

function resolveWasmDir(): string {
  // 1. Try to resolve via the installed package (works after npm install)
  try {
    const pkgMain = _require.resolve('tree-sitter-wasms/package.json');
    return path.join(path.dirname(pkgMain), 'out');
  } catch { /* fall through */ }
  // 2. Walk up from __dirname looking for node_modules/tree-sitter-wasms
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  for (let dir = here; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', 'tree-sitter-wasms', 'out');
    if (fs.existsSync(candidate)) return candidate;
  }
  // 3. Last resort: relative to dist/
  return path.join(here, '../../../node_modules/tree-sitter-wasms/out');
}

const _wasmDir = resolveWasmDir();

export interface CodeChunk {
  id: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  fullBody: string;
  chunkType: 'function' | 'class' | 'method' | 'block' | 'fallback';
  name?: string;
  confidence: 'high' | 'low';
}

const SUPPORTED_LANGUAGES: Record<string, string[]> = {
  python:     ['.py'],
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  go:         ['.go'],
  rust:       ['.rs'],
  java:       ['.java'],
  c:          ['.c', '.h'],
  cpp:        ['.cpp', '.cc', '.cxx', '.hpp'],
  html:       ['.html', '.htm'],
};

function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  for (const [lang, exts] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (exts.includes(ext)) return lang;
  }
  return null;
}

let _parserModule: unknown = null;
let _parserLoaded = false;

async function loadParser(): Promise<unknown> {
  if (_parserLoaded) return _parserModule;
  try {
    const Parser = await import('web-tree-sitter');
    await (Parser.default as { init: () => Promise<void> }).init();
    _parserModule = Parser.default;
    _parserLoaded = true;
    return _parserModule;
  } catch {
    _parserLoaded = true;
    _parserModule = null;
    return null;
  }
}

const _grammarCache = new Map<string, unknown>();

const LANG_WASM_NAME: Record<string, string> = {
  python:     'python',
  typescript: 'typescript',
  javascript: 'javascript',
  go:         'go',
  rust:       'rust',
  java:       'java',
  c:          'c',
  cpp:        'cpp',
};

async function loadGrammar(language: string): Promise<unknown | null> {
  if (_grammarCache.has(language)) return _grammarCache.get(language)!;
  const parser = await loadParser();
  if (!parser) return null;
  try {
    const wasmName = LANG_WASM_NAME[language];
    if (!wasmName) return null;
    const wasmPath = path.join(_wasmDir, `tree-sitter-${wasmName}.wasm`);
    if (!fs.existsSync(wasmPath)) return null;
    const Parser = parser as { Language: { load: (path: string) => Promise<unknown> }; new(): ParserInstance };
    const lang = await Parser.Language.load(wasmPath);
    _grammarCache.set(language, lang);
    return lang;
  } catch {
    return null;
  }
}

interface ParserInstance {
  setLanguage(lang: unknown): void;
  parse(src: string): TreeNode;
}

interface TreeNode {
  rootNode: SyntaxNode;
}

interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number };
  endPosition: { row: number };
  children: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
}

const FUNCTION_TYPES = new Set([
  'function_definition',     // Python
  'function_declaration',    // JS/TS
  'function_expression',
  'arrow_function',
  'method_definition',
  'method_declaration',
  'function_item',           // Rust
  'func_declaration',        // Go
  'func_literal',
]);

const CLASS_TYPES = new Set([
  'class_definition',
  'class_declaration',
  'struct_item',
  'impl_item',
  'interface_declaration',
]);

function extractChunksFromTree(
  rootNode: SyntaxNode,
  source: string,
  filePath: string,
  language: string,
): CodeChunk[] {
  const lines = source.split('\n');
  const chunks: CodeChunk[] = [];

  function walk(node: SyntaxNode): void {
    if (FUNCTION_TYPES.has(node.type)) {
      const nameNode =
        node.childForFieldName('name') ??
        node.children.find((c) => c.type === 'identifier') ?? null;
      const name = nameNode?.text ?? '<anonymous>';
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;
      const fullBody = lines.slice(startLine, endLine + 1).join('\n');
      chunks.push({
        id: randomUUID(),
        filePath,
        language,
        startLine,
        endLine,
        fullBody,
        chunkType: node.type === 'method_definition' || node.type === 'method_declaration' ? 'method' : 'function',
        name,
        confidence: 'high',
      });
      return; // don't recurse into function body
    }
    if (CLASS_TYPES.has(node.type)) {
      const nameNode = node.childForFieldName('name') ?? node.children.find((c) => c.type === 'identifier') ?? null;
      const name = nameNode?.text ?? '<anonymous>';
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;
      const fullBody = lines.slice(startLine, endLine + 1).join('\n');
      chunks.push({
        id: randomUUID(),
        filePath,
        language,
        startLine,
        endLine,
        fullBody,
        chunkType: 'class',
        name,
        confidence: 'high',
      });
      // Still recurse into class body to get methods
    }
    for (const child of node.children) walk(child);
  }

  walk(rootNode);
  return chunks;
}

function fallbackChunks(source: string, filePath: string, language: string): CodeChunk[] {
  const lines = source.split('\n');
  const chunkSize = 60;
  const chunks: CodeChunk[] = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    const endLine = Math.min(i + chunkSize - 1, lines.length - 1);
    chunks.push({
      id: randomUUID(),
      filePath,
      language,
      startLine: i,
      endLine,
      fullBody: lines.slice(i, endLine + 1).join('\n'),
      chunkType: 'fallback',
      confidence: 'low',
    });
  }
  return chunks;
}

/**
 * Extract <script> tag contents from HTML files and return as JavaScript chunks.
 */
function extractHtmlScripts(source: string, filePath: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  while ((match = scriptRegex.exec(source)) !== null) {
    const scriptContent = match[1]!.trim();
    if (!scriptContent || scriptContent.length < 10) continue;
    // Calculate the line offset of this script in the original file
    const beforeScript = source.slice(0, match.index);
    const lineOffset = beforeScript.split('\n').length - 1;
    // Create a chunk for the entire script block
    const lines = scriptContent.split('\n');
    chunks.push({
      id: randomUUID(),
      filePath,
      language: 'javascript',
      startLine: lineOffset,
      endLine: lineOffset + lines.length - 1,
      fullBody: scriptContent,
      chunkType: 'block',
      name: `script_${scriptIndex}`,
      confidence: 'high',
    });
    scriptIndex++;
  }
  // If no scripts found, fall back to treating the whole file as a block
  if (chunks.length === 0) {
    chunks.push({
      id: randomUUID(),
      filePath,
      language: 'html',
      startLine: 0,
      endLine: source.split('\n').length - 1,
      fullBody: source.length > 2000 ? source.slice(0, 2000) : source,
      chunkType: 'fallback',
      confidence: 'low',
    });
  }
  return chunks;
}

export async function chunkFile(filePath: string): Promise<CodeChunk[]> {
  const language = detectLanguage(filePath);
  const source = fs.readFileSync(filePath, 'utf-8');
  if (!language) return fallbackChunks(source, filePath, 'unknown');

  // HTML files: extract <script> tags and chunk as JavaScript
  if (language === 'html') {
    return extractHtmlScripts(source, filePath);
  }

  const grammar = await loadGrammar(language);
  if (!grammar) return fallbackChunks(source, filePath, language);

  try {
    const Parser = _parserModule as { new(): ParserInstance };
    const parser = new Parser();
    parser.setLanguage(grammar);
    const tree = parser.parse(source);
    const chunks = extractChunksFromTree(tree.rootNode, source, filePath, language);
    if (chunks.length === 0) return fallbackChunks(source, filePath, language);
    return chunks;
  } catch {
    return fallbackChunks(source, filePath, language);
  }
}

export function isSupportedLanguage(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}

export function getSupportedExtensions(): string[] {
  return Object.values(SUPPORTED_LANGUAGES).flat();
}
