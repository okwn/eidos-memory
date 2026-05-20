import fs from 'fs';
import path from 'path';
import https from 'https';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require   = createRequire(import.meta.url);

const REGISTRY_URL = 'https://raw.githubusercontent.com/eidos-memory/adapters/main/registry.json';
const LOCAL_ADAPTER_DIR = path.join(os.homedir(), '.eidos', 'adapters');

function resolveBuiltinAdaptersDir(): string {
  // 1. From compiled dist/cli/ → ../../adapters
  const fromDist = path.join(__dirname, '..', '..', 'adapters');
  if (fs.existsSync(fromDist)) return fromDist;
  // 2. From package.json resolution
  try {
    const pkgJson = _require.resolve('eidos-memory/package.json');
    const candidate = path.join(path.dirname(pkgJson), 'adapters');
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* not installed as eidos-memory */ }
  // 3. cwd fallback
  return path.join(process.cwd(), 'adapters');
}

interface AdapterManifest {
  name: string;
  description: string;
  version: string;
  url: string;
}

interface Registry {
  adapters: AdapterManifest[];
}

function ensureAdapterDir(): void {
  fs.mkdirSync(LOCAL_ADAPTER_DIR, { recursive: true });
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject);
  });
}

export async function installAdapter(name: string): Promise<void> {
  ensureAdapterDir();

  // First check built-in adapters directory
  const builtinPath = path.join(resolveBuiltinAdaptersDir(), `${name}.json`);
  if (fs.existsSync(builtinPath)) {
    const dest = path.join(LOCAL_ADAPTER_DIR, `${name}.json`);
    fs.copyFileSync(builtinPath, dest);
    console.log(`[eidos] Installed built-in adapter '${name}' → ${dest}`);
    return;
  }

  // Fetch from registry
  console.log(`[eidos] Fetching adapter registry...`);
  let registry: Registry;
  try {
    registry = await fetchJson<Registry>(REGISTRY_URL);
  } catch {
    console.error(`[eidos] Could not reach adapter registry. Check your network connection.`);
    process.exit(1);
  }

  const manifest = registry.adapters.find(
    (a) => a.name === name || a.name === `${name}.json`,
  );

  if (!manifest) {
    console.error(`[eidos] Adapter '${name}' not found in registry.`);
    console.log(`[eidos] Available adapters: ${registry.adapters.map((a) => a.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`[eidos] Downloading adapter '${name}' v${manifest.version}...`);
  const content = await fetchText(manifest.url);
  const dest = path.join(LOCAL_ADAPTER_DIR, `${name}.json`);
  fs.writeFileSync(dest, content);
  console.log(`[eidos] Adapter '${name}' installed to ${dest}`);
}

export async function listAdapters(): Promise<void> {
  ensureAdapterDir();

  // Local installed adapters
  const localFiles = fs.existsSync(LOCAL_ADAPTER_DIR)
    ? fs.readdirSync(LOCAL_ADAPTER_DIR).filter((f) => f.endsWith('.json'))
    : [];

  // Built-in adapters (resolved from package install location)
  const builtinDir = resolveBuiltinAdaptersDir();
  const builtinFiles = fs.existsSync(builtinDir)
    ? fs.readdirSync(builtinDir).filter((f) => f.endsWith('.json'))
    : [];

  const GREEN = '\x1b[32m'; const CYAN = '\x1b[36m'; const BOLD = '\x1b[1m';
  const RESET = '\x1b[0m'; const DIM = '\x1b[2m'; const YELLOW = '\x1b[33m';

  console.log(`\n${BOLD}${CYAN}⚡ EidosCore Adapters${RESET}\n`);

  if (builtinFiles.length === 0 && localFiles.length === 0) {
    console.log(`  ${DIM}(none found — run: npm run build)${RESET}`);
  } else {
    if (builtinFiles.length > 0) {
      console.log(`  ${BOLD}Built-in adapters${RESET}  ${DIM}(${builtinDir})${RESET}`);
      for (const f of builtinFiles) {
        const name = f.replace('.json', '');
        let detect = '';
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(builtinDir, f), 'utf-8')) as { detect?: string[]; injection?: { method?: string } };
          detect = cfg.detect?.join(', ') ?? '';
          const method = cfg.injection?.method ? ` ${DIM}[${cfg.injection.method}]${RESET}` : '';
          console.log(`    ${GREEN}✔${RESET} ${BOLD}${name.padEnd(18)}${RESET} ${DIM}detects: ${detect}${RESET}${method}`);
        } catch {
          console.log(`    ${GREEN}✔${RESET} ${BOLD}${name}${RESET}`);
        }
      }
    }
    if (localFiles.length > 0) {
      console.log(`\n  ${BOLD}User adapters${RESET}  ${DIM}(${LOCAL_ADAPTER_DIR})${RESET}`);
      for (const f of localFiles) {
        console.log(`    ${YELLOW}✦${RESET} ${f.replace('.json', '')}`);
      }
    }
  }
  console.log(`\n  ${DIM}eidos adapter install <name>  — install a built-in adapter to user dir${RESET}`);
  console.log('');
}

export function resolveAdapter(cliName: string): string | null {
  // Search order: user adapters → built-in adapters
  const searchDirs = [LOCAL_ADAPTER_DIR, path.join(process.cwd(), 'adapters')];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        const filePath = path.join(dir, file);
        const cfg = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { detect?: string[] };
        if (cfg.detect?.some((d) => cliName.includes(d))) return filePath;
      } catch { /* skip */ }
    }
  }
  return null;
}
