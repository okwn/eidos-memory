#!/usr/bin/env node
/**
 * EidosCore release script
 * Usage: node scripts/release.mjs [patch|minor|major]
 */
import { execSync } from 'child_process';
import fs from 'fs';

const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const RED    = '\x1b[31m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

function run(cmd, opts = {}) {
  console.log(`${CYAN}→ ${cmd}${RESET}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function step(msg) {
  console.log(`\n${BOLD}${GREEN}▸ ${msg}${RESET}`);
}

function bumpVersion(bump) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  if (bump === 'major') pkg.version = `${major + 1}.0.0`;
  else if (bump === 'minor') pkg.version = `${major}.${minor + 1}.0`;
  else pkg.version = `${major}.${minor}.${patch + 1}`;
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  return pkg.version;
}

function generateChangelog(version) {
  let log = '';
  try {
    log = execSync(
      'git log --pretty=format:"- %s (%h)" $(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")..HEAD',
      { encoding: 'utf-8' }
    ).trim();
  } catch {
    log = '- Initial release';
  }

  const entry = `\n## v${version} — ${new Date().toISOString().slice(0, 10)}\n\n${log}\n`;
  const existing = fs.existsSync('CHANGELOG.md') ? fs.readFileSync('CHANGELOG.md', 'utf-8') : '# Changelog\n';
  const header = existing.split('\n').slice(0, 2).join('\n');
  const rest   = existing.split('\n').slice(2).join('\n');
  fs.writeFileSync('CHANGELOG.md', `${header}\n${entry}\n${rest}`);
  return entry;
}

async function main() {
  const bump = process.argv[2] ?? 'patch';
  if (!['patch', 'minor', 'major'].includes(bump)) {
    console.error(`${RED}Usage: node scripts/release.mjs [patch|minor|major]${RESET}`);
    process.exit(1);
  }

  step('Check working tree is clean');
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    if (status) {
      console.error(`${RED}Working tree is dirty. Commit or stash changes first.${RESET}`);
      process.exit(1);
    }
  } catch {
    console.log('(git not available — skipping clean check)');
  }

  step('Run tests');
  run('npm test');

  step('Build');
  run('npm run build');

  step(`Bump version (${bump})`);
  const version = bumpVersion(bump);
  console.log(`  → v${version}`);

  step('Generate changelog');
  generateChangelog(version);

  step('Commit + tag');
  try {
    run(`git add package.json CHANGELOG.md`);
    run(`git commit -m "chore: release v${version}"`);
    run(`git tag v${version}`);
  } catch {
    console.log('(git not available — skipping commit/tag)');
  }

  step('Publish to npm');
  run('npm publish --access public');

  step('Push tags');
  try {
    run('git push --follow-tags');
  } catch {
    console.log('(git push skipped — push manually if needed)');
  }

  console.log(`\n${GREEN}${BOLD}🚀 Released eidos-memory@${version}${RESET}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
