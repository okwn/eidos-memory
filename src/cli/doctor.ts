import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const _require = createRequire(import.meta.url);

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

type Status = 'ok' | 'warn' | 'fail';
interface Check { label: string; status: Status; detail: string; fix?: string }

function ok(label: string, detail = '')              : Check { return { label, status: 'ok',   detail }; }
function warn(label: string, detail = '', fix = ''): Check { return { label, status: 'warn', detail, fix }; }
function fail(label: string, detail = '', fix = ''): Check { return { label, status: 'fail', detail, fix }; }

function icon(s: Status): string {
  if (s === 'ok')   return `${GREEN}✔${RESET}`;
  if (s === 'warn') return `${YELLOW}⚠${RESET}`;
  return `${RED}✖${RESET}`;
}

async function checkNodeVersion(): Promise<Check> {
  const [major] = process.versions.node.split('.').map(Number);
  if (major >= 20) return ok('Node.js', `v${process.versions.node}`);
  return fail('Node.js', `v${process.versions.node} — requires >=20`);
}

async function checkSqlite(): Promise<Check> {
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    db.prepare('SELECT 1').get();
    db.close();
    return ok('better-sqlite3', 'connected to :memory: successfully');
  } catch (e) {
    return fail('better-sqlite3', String(e));
  }
}

async function checkVec(): Promise<Check> {
  try {
    const { isVssLoaded, getVecBackend, resetDbInstance } = await import('../store/db.js');
    process.env['EIDOS_WORKSPACE'] = os.tmpdir();
    resetDbInstance();
    const { getDb } = await import('../store/db.js');
    getDb();
    const loaded = isVssLoaded();
    const backend = getVecBackend();
    resetDbInstance();
    if (loaded && backend === 'vec')  return ok('Vector search', 'sqlite-vec v0.1.9 — ANN search active');
    if (loaded && backend === 'vss')  return ok('Vector search', 'sqlite-vss (legacy) — ANN search active');
    return warn(
      'Vector search',
      'not available — linear cosine fallback (works, slower on >50k nodes)',
      'npm install sqlite-vec',
    );
  } catch (e) {
    return warn('Vector search', `could not check: ${e}`, 'npm install sqlite-vec');
  }
}

async function checkWasm(): Promise<Check> {
  try {
    const { createRequire } = await import('module');
    const _req = createRequire(import.meta.url);
    // Use the same resolution logic as chunker.ts
    let wasmDir: string | null = null;
    try {
      const pkgMain = _req.resolve('tree-sitter-wasms/package.json');
      wasmDir = path.join(path.dirname(pkgMain), 'out');
    } catch { /* fall through */ }
    if (!wasmDir) {
      return warn(
        'WASM grammars',
        'tree-sitter-wasms not installed — AST chunking unavailable',
        'npm install tree-sitter-wasms',
      );
    }
    const wasmFile = path.join(wasmDir, 'tree-sitter-typescript.wasm');
    if (fs.existsSync(wasmFile)) return ok('WASM grammars', `${wasmDir}`);
    return warn(
      'WASM grammars',
      `out/ directory missing in tree-sitter-wasms`,
      'npm install tree-sitter-wasms',
    );
  } catch (e) {
    return warn('WASM grammars', String(e), 'npm install tree-sitter-wasms');
  }
}

async function checkEmbeddingModel(): Promise<Check> {
  const eidosModelDir = path.join(os.homedir(), '.eidos', 'models');
  const xenovaDir     = path.join(os.homedir(), '.cache', 'xenova');
  const hfDir         = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
  const hasMiniLM = [
    eidosModelDir, xenovaDir, hfDir,
  ].some(d => fs.existsSync(d) && fs.readdirSync(d).some(f => f.toLowerCase().includes('minilm')));
  if (hasMiniLM) return ok('Embedding model', 'all-MiniLM-L6-v2 cached ✔');
  // Check if directory exists at all
  const anyExists = [eidosModelDir, xenovaDir, hfDir].some(d => fs.existsSync(d));
  if (anyExists) return ok('Embedding model', 'cache directory present — model will load on first use');
  return warn(
    'Embedding model',
    '~22 MB download on first `eidos index` — automatic, with progress bar',
    'eidos index .   (triggers auto-download)',
  );
}

async function checkEidosDir(): Promise<Check> {
  const eidosDir = path.join(os.homedir(), '.eidos');
  try {
    fs.mkdirSync(eidosDir, { recursive: true });
    const testFile = path.join(eidosDir, '.write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return ok('~/.eidos directory', `${eidosDir} writable`);
  } catch (e) {
    return fail('~/.eidos directory', `not writable: ${e}`);
  }
}

function resolveAdaptersDir(): string {
  // 1. Next to the running script (works from source)
  try {
    const pkgJson = _require.resolve('eidos-memory/package.json');
    const candidate = path.join(path.dirname(pkgJson), 'adapters');
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* fall through */ }
  // 2. Relative to the compiled dist file (dist/cli/ → adapters/)
  const __dir = path.dirname(fileURLToPath(import.meta.url));
  const fromDist = path.join(__dir, '../../adapters');
  if (fs.existsSync(fromDist)) return fromDist;
  // 3. cwd fallback
  return path.join(process.cwd(), 'adapters');
}

async function checkAdapters(): Promise<Check> {
  const adaptersDir = resolveAdaptersDir();
  if (!fs.existsSync(adaptersDir)) {
    return warn('Adapters', 'adapters/ directory not found', 'npm install -g .');
  }
  const files = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.json'));
  const bad: string[] = [];
  for (const f of files) {
    try { JSON.parse(fs.readFileSync(path.join(adaptersDir, f), 'utf-8')); }
    catch { bad.push(f); }
  }
  if (bad.length > 0) return fail('Adapters', `invalid JSON: ${bad.join(', ')}`);
  return ok('Adapters', `${files.length} adapters valid (${files.map(f => f.replace('.json', '')).join(', ')})`);
}

async function checkConfig(): Promise<Check> {
  // Look in EIDOS_WORKSPACE or cwd — but don't warn if neither has a config (it's optional)
  const searchDirs = [
    process.env['EIDOS_WORKSPACE'],
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const dir of searchDirs) {
    const cfgPath = path.join(dir, 'eidos.config.json');
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
      const required = ['token_budget', 'adaptive_budget'];
      const missing = required.filter(k => !(k in cfg));
      if (missing.length > 0)
        return warn('eidos.config.json', `${cfgPath} — missing: ${missing.join(', ')}`, 'eidos config --fix');
      return ok('eidos.config.json', `valid (${cfgPath})`);
    } catch (e) {
      return fail('eidos.config.json', `invalid JSON in ${cfgPath}: ${e}`, 'eidos config --fix');
    }
  }
  // No config found anywhere — not an error, just using defaults
  return ok('eidos.config.json', 'not found in cwd — using built-in defaults');
}

async function checkGit(): Promise<Check> {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return ok('git', 'available');
  } catch {
    return warn('git', 'not found — git hooks won\'t work');
  }
}

async function checkEnvironment(): Promise<Check> {
  const issues: string[] = [];

  // Check for critical env vars
  if (process.env['EIDOS_WORKSPACE'] && !fs.existsSync(process.env['EIDOS_WORKSPACE'])) {
    issues.push('EIDOS_WORKSPACE path does not exist');
  }

  // Verify `eidos` binary is on PATH (most reliable signal — works with conda, nvm, etc.)
  try {
    const ver = execSync('eidos --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!ver) issues.push('eidos binary not responding');
  } catch {
    issues.push('eidos not on PATH — run: npm install -g .');
  }

  if (issues.length === 0) {
    return ok('Environment', 'eidos on PATH, env vars OK');
  }
  return warn('Environment', issues.join('; '), 'npm install -g .');
}

async function checkPkgVersion(): Promise<Check> {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, '../../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
      return ok('EidosCore version', 'v' + pkg.version);
    }
    const pkgPath2 = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath2)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath2, 'utf-8')) as { version: string; name?: string };
      if (pkg.name === 'eidos-memory' || pkg.name === 'eidos-core') {
        return ok('EidosCore version', 'v' + pkg.version);
      }
    }
  } catch { /* ignore */ }
  return ok('EidosCore version', 'v0.1.0');
}

export async function runDoctor(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}⚡ EidosCore Doctor${RESET}\n`);

  const checks = await Promise.all([
    checkPkgVersion(),
    checkNodeVersion(),
    checkSqlite(),
    checkVec(),
    checkWasm(),
    checkEmbeddingModel(),
    checkEidosDir(),
    checkAdapters(),
    checkConfig(),
    checkGit(),
    checkEnvironment(),
  ]);

  let fails = 0, warns = 0;
  const fixLines: string[] = [];
  for (const ch of checks) {
    const pad = ch.label.padEnd(26);
    console.log(`  ${icon(ch.status)} ${BOLD}${pad}${RESET}  ${ch.detail}`);
    if (ch.status === 'fail') { fails++; if (ch.fix) fixLines.push(`  ${RED}✖${RESET} ${BOLD}${ch.label}:${RESET} ${CYAN}${ch.fix}${RESET}`); }
    if (ch.status === 'warn') { warns++; if (ch.fix) fixLines.push(`  ${YELLOW}⚡${RESET} ${BOLD}${ch.label}:${RESET} ${CYAN}${ch.fix}${RESET}`); }
  }

  console.log('');
  if (fixLines.length > 0) {
    console.log(`${BOLD}  Suggested fixes:${RESET}`);
    fixLines.forEach(l => console.log(l));
    console.log('');
  }

  if (fails === 0 && warns === 0) {
    console.log(`${GREEN}${BOLD}  ✔ All checks passed. EidosCore is fully operational.${RESET}`);
  } else if (fails === 0) {
    console.log(`${YELLOW}${BOLD}  ${warns} warning(s). EidosCore works — apply fixes above for best performance.${RESET}`);
  } else {
    console.log(`${RED}${BOLD}  ${fails} failure(s), ${warns} warning(s). Fix the issues above.${RESET}`);
    process.exit(1);
  }
  console.log('');
}
