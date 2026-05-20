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

export function installGitHook(workspaceDir: string): boolean {
  const gitRoot = findGitRoot(workspaceDir);
  if (!gitRoot) {
    console.log('[eidos] No git repository found. Skipping git hook installation.');
    return false;
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'post-commit');
  const hookContent = process.platform === 'win32' ? POST_COMMIT_HOOK_WIN : POST_COMMIT_HOOK;

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes('EidosCore')) {
      console.log('[eidos] Git post-commit hook already installed.');
      return true;
    }
    // Append to existing hook
    fs.appendFileSync(hookPath, `\n${hookContent}`);
  } else {
    fs.writeFileSync(hookPath, hookContent);
  }

  // Make executable on Unix
  if (process.platform !== 'win32') {
    try { execSync(`chmod +x "${hookPath}"`); } catch { /* ignore */ }
  }

  console.log(`[eidos] Git post-commit hook installed: ${hookPath}`);
  return true;
}

export function installWindowsShellHook(): void {
  const psProfilePath = getPowershellProfile();
  if (!psProfilePath) {
    console.log('[eidos] Could not determine PowerShell profile path.');
    return;
  }

  const profileDir = path.dirname(psProfilePath);
  fs.mkdirSync(profileDir, { recursive: true });

  const marker = '# EidosCore memory injection';
  if (fs.existsSync(psProfilePath)) {
    const existing = fs.readFileSync(psProfilePath, 'utf-8');
    if (existing.includes(marker)) {
      console.log(`[eidos] PowerShell profile already patched: ${psProfilePath}`);
      return;
    }
    fs.appendFileSync(psProfilePath, `\n${POWERSHELL_PROFILE_SNIPPET}\n`);
  } else {
    fs.writeFileSync(psProfilePath, POWERSHELL_PROFILE_SNIPPET);
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
