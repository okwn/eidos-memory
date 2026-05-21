import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const POST_COMMIT_HOOK = `#!/bin/sh
# EidosCore auto-index on git commit
if command -v eidos >/dev/null 2>&1; then
  eidos index . -q &
fi
`;

const POST_COMMIT_HOOK_WIN = `#!/bin/sh
# EidosCore auto-index on git commit (Windows)
eidos index . -q 2>/dev/null &
`;

const POST_CHECKOUT_HOOK = `#!/bin/sh
# EidosCore auto-reindex on git checkout/branch switch
# $1 = previous HEAD, $2 = new HEAD, $3 = 1 (branch checkout) or 0 (file checkout)
if [ "$3" = "1" ] && command -v eidos >/dev/null 2>&1; then
  eidos index . -q &
fi
`;

const POWERSHELL_PROFILE_SNIPPET = `
# EidosCore memory injection
function Invoke-EidosWrap {
  param([string]$Cli, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
  if (Get-Command eidos -ErrorAction SilentlyContinue) {
    & eidos wrap $Cli @Args
  } else {
    & $Cli @Args
  }
}
`;

function findGitRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function installSingleHook(hooksDir: string, hookName: string, hookContent: string): boolean {
  const hookPath = path.join(hooksDir, hookName);
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes('EidosCore')) return true;
    fs.appendFileSync(hookPath, `\n${hookContent}`);
  } else {
    fs.writeFileSync(hookPath, hookContent);
  }
  if (process.platform !== 'win32') {
    try { execSync(`chmod +x "${hookPath}"`); } catch { /* ignore */ }
  }
  return false;
}

export function installGitHook(workspaceDir: string): boolean {
  const gitRoot = findGitRoot(workspaceDir);
  if (!gitRoot) {
    console.log('[eidos] No git repository found. Skipping git hook installation.');
    return false;
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const commitContent = process.platform === 'win32' ? POST_COMMIT_HOOK_WIN : POST_COMMIT_HOOK;
  installSingleHook(hooksDir, 'post-commit', commitContent);
  console.log(`[eidos] Git post-commit hook installed: ${path.join(hooksDir, 'post-commit')}`);

  installSingleHook(hooksDir, 'post-checkout', POST_CHECKOUT_HOOK);
  console.log(`[eidos] Git post-checkout hook installed: ${path.join(hooksDir, 'post-checkout')}`);

  return true;
}

export function installWindowsShellHook(detectedClis?: string[]): void {
  const psProfilePath = getPowershellProfile();
  if (!psProfilePath) {
    console.log('[eidos] Could not determine PowerShell profile path.');
    return;
  }

  const profileDir = path.dirname(psProfilePath);
  fs.mkdirSync(profileDir, { recursive: true });

  const marker = '# EidosCore memory injection';
  const wrapperMarker = '# EidosCore CLI wrappers';

  // Build the full snippet: base function + per-CLI wrappers
  let snippet = POWERSHELL_PROFILE_SNIPPET;
  if (detectedClis && detectedClis.length > 0) {
    snippet += '\n# EidosCore CLI wrappers\n';
    for (const cli of detectedClis) {
      snippet += `function ${cli} { Invoke-EidosWrap -Cli ${cli} @args }\n`;
    }
  }

  if (fs.existsSync(psProfilePath)) {
    const existing = fs.readFileSync(psProfilePath, 'utf-8');
    if (existing.includes(marker)) {
      // Already has the base hook — check if wrappers need adding
      if (detectedClis && detectedClis.length > 0 && !existing.includes(wrapperMarker)) {
        fs.appendFileSync(psProfilePath, `\n${wrapperMarker}\n`);
        for (const cli of detectedClis) {
          fs.appendFileSync(psProfilePath, `function ${cli} { Invoke-EidosWrap -Cli ${cli} @args }\n`);
        }
        console.log(`[eidos] Added CLI wrappers to profile for: ${detectedClis.join(', ')}`);
      } else {
        console.log(`[eidos] PowerShell profile already patched: ${psProfilePath}`);
      }
      return;
    }
    fs.appendFileSync(psProfilePath, `\n${snippet}\n`);
  } else {
    fs.writeFileSync(psProfilePath, snippet);
  }

  console.log(`[eidos] PowerShell profile patched: ${psProfilePath}`);
  console.log('[eidos] Restart PowerShell or run: . $PROFILE');
}

function getPowershellProfile(): string | null {
  try {
    const result = execSync('powershell -NoProfile -Command "echo $PROFILE"', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return result || null;
  } catch {
    // Fallback to standard location
    const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
    return path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
  }
}
