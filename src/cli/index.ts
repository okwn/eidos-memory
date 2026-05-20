#!/usr/bin/env node
import { Command } from 'commander';
import { wrapCommand } from './wrap.js';
import { initCommand } from './init.js';
import { statsCommand } from './stats.js';

const program = new Command();

program
  .name('eidos')
  .description('EidosCore — Universal AI Memory & Token Efficiency Engine')
  .version('0.1.0');

program
  .command('index [path]')
  .description('Index a directory into the knowledge hypergraph')
  .option('-l, --languages <langs>', 'Comma-separated language list', 'python,typescript,javascript')
  .option('-q, --quiet', 'Suppress output for background indexing')
  .action(async (indexPath: string = '.', opts: { languages: string; quiet?: boolean }) => {
    const { runIndexProject } = await import('./commands/index-project.js');
    await runIndexProject(indexPath, opts.languages.split(','), opts.quiet ?? false);
  });

program
  .command('wrap <cli> [args...]')
  .description('Run a CLI tool with EidosCore memory injection')
  .option('-q, --query <query>', 'Override query used for context assembly')
  .option('-b, --budget <n>', 'Token budget override', '2000')
  .option('--no-memory', 'Skip memory injection — raw passthrough (also: EIDOS_NO_MEMORY=1)')
  .action(async (cli: string, args: string[], opts: { query?: string; budget: string; memory?: boolean }) => {
    if (opts.memory === false) process.env['EIDOS_NO_MEMORY'] = '1';
    await wrapCommand(cli, args, { query: opts.query, budget: parseInt(opts.budget, 10) });
  });

program
  .command('init')
  .description('Set up EidosCore globally (shell hooks, workspace init)')
  .option('--global', 'Patch shell profile for all detected CLIs')
  .action(async (opts: { global?: boolean }) => {
    await initCommand({ global: opts.global ?? false });
  });

program
  .command('stats')
  .description('Show token savings dashboard for current session/workspace')
  .option('-w, --watch', 'Live-update every 5 seconds')
  .option('-d, --debug', 'Show raw DB path and lifetime_savings row for verification')
  .action(async (opts: { watch?: boolean; debug?: boolean }) => {
    await statsCommand({ debug: opts.debug });
    if (opts.watch) {
      setInterval(async () => {
        console.clear();
        await statsCommand({ debug: opts.debug });
      }, 5000);
    }
  });

const mcpCmd = program
  .command('mcp')
  .description('MCP server commands');

mcpCmd
  .command('start')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer();
  });

// Legacy: `eidos mcp` with no subcommand also starts server
mcpCmd
  .action(async () => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer();
  });

mcpCmd
  .command('print-config')
  .description('Print MCP client config snippet')
  .option('-c, --client <name>', 'Client: claude-desktop, continue, vscode, generic', 'claude-desktop')
  .option('--copy', 'Auto-write to the client config file')
  .action(async (opts: { client: string; copy?: boolean }) => {
    const { printMcpConfig } = await import('./mcp_config.js');
    await printMcpConfig(opts.client as 'claude-desktop' | 'continue' | 'vscode' | 'generic', opts.copy ?? false);
  });

mcpCmd
  .command('pid')
  .description('Print daemon PID if running')
  .action(async () => {
    const { daemonPid } = await import('./daemon.js');
    daemonPid();
  });

mcpCmd
  .command('test')
  .description('Test MCP server tools via JSON-RPC (verify all 12 tools work)')
  .option('-t, --tool <name>', 'Test a specific tool by name')
  .option('-a, --args <json>', 'JSON arguments for the tool')
  .option('--all', 'Test all safe tools in sequence')
  .action(async (opts: { tool?: string; args?: string; all?: boolean }) => {
    const { runMcpTest } = await import('./mcp_test.js');
    await runMcpTest({ tool: opts.tool, args: opts.args, all: opts.all });
  });

program
  .command('reset')
  .description('Clear workspace memory database')
  .action(async () => {
    const { resetWorkspace } = await import('./commands/reset.js');
    await resetWorkspace();
  });

program
  .command('export-qms <session-id> [out-file]')
  .description('Export a Quantum Memory Seed to a JSON file')
  .action(async (sessionId: string, outFile: string = `qms-${sessionId}.json`) => {
    const { exportQms } = await import('./qms.js');
    await exportQms(sessionId, outFile);
  });

program
  .command('import-qms <file>')
  .description('Import a Quantum Memory Seed and pre-warm cache')
  .action(async (file: string) => {
    const { importQms } = await import('./qms.js');
    await importQms(file);
  });

program
  .command('proxy')
  .description('Start OpenAI-compatible HTTP proxy with memory injection')
  .option('-p, --port <n>', 'Proxy listen port', '4141')
  .option('-u, --upstream <url>', 'Upstream OpenAI-compatible API URL', 'https://api.openai.com')
  .action(async (opts: { port: string; upstream: string }) => {
    const { startProxy } = await import('./proxy.js');
    await startProxy(parseInt(opts.port, 10), opts.upstream);
  });

const adapterCmd = program
  .command('adapter')
  .description('Manage EidosCore CLI adapters');

adapterCmd
  .command('install <name>')
  .description('Install an adapter by name (built-in or from registry)')
  .action(async (name: string) => {
    const { installAdapter } = await import('./adapter_registry.js');
    await installAdapter(name);
  });

adapterCmd
  .command('list')
  .description('List installed adapters')
  .action(async () => {
    const { listAdapters } = await import('./adapter_registry.js');
    await listAdapters();
  });

const workspacesCmd = program
  .command('workspaces')
  .description('Manage EidosCore workspaces (multi-project memory)');

workspacesCmd
  .command('list')
  .description('List all registered workspaces')
  .action(async () => {
    const { listWorkspaces } = await import('./workspaces.js');
    await listWorkspaces();
  });

workspacesCmd
  .command('switch <name-or-path>')
  .description('Switch active workspace by name or path')
  .action(async (nameOrPath: string) => {
    const { switchWorkspace } = await import('./workspaces.js');
    await switchWorkspace(nameOrPath);
  });

workspacesCmd
  .command('remove <name-or-path>')
  .description('Remove a workspace from the registry')
  .action(async (nameOrPath: string) => {
    const { removeWorkspace } = await import('./workspaces.js');
    await removeWorkspace(nameOrPath);
  });

const daemonCmd = program
  .command('daemon')
  .description('Manage the EidosCore background daemon (MCP + proxy + dashboard)');

daemonCmd
  .command('start')
  .description('Start daemon in background')
  .option('--mcp <port>', 'MCP TCP bridge port', '3742')
  .option('--proxy <port>', 'Proxy port', '4141')
  .option('--dash <port>', 'Dashboard port', '7842')
  .action(async (opts: { mcp: string; proxy: string; dash: string }) => {
    const { startDaemon } = await import('./daemon.js');
    await startDaemon({ mcp: +opts.mcp, proxy: +opts.proxy, dash: +opts.dash });
  });

daemonCmd
  .command('stop')
  .description('Stop the running daemon')
  .action(async () => {
    const { stopDaemon } = await import('./daemon.js');
    stopDaemon();
  });

daemonCmd
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const { getDaemonStatus } = await import('./daemon.js');
    const s = getDaemonStatus();
    if (s.running) {
      console.log(`[eidos] Daemon running (PID ${s.pid}) — MCP :${s.mcpPort} Proxy :${s.proxyPort} Dash :${s.dashPort}`);
    } else {
      console.log('[eidos] Daemon not running. Start with: eidos daemon start');
    }
  });

program
  .command('run <cli> [args...]')
  .description('Smart alias for eidos wrap — auto-detects adapter from command name')
  .option('-q, --query <query>', 'Override query used for context assembly')
  .option('-b, --budget <n>', 'Token budget override', '2000')
  .option('--no-memory', 'Skip memory injection — raw passthrough')
  .action(async (cli: string, args: string[], opts: { query?: string; budget: string; memory?: boolean }) => {
    if (opts.memory === false) process.env['EIDOS_NO_MEMORY'] = '1';
    await wrapCommand(cli, args, { query: opts.query, budget: parseInt(opts.budget, 10) });
  });

program
  .command('doctor')
  .description('Run health checks for your EidosCore installation')
  .action(async () => {
    const { runDoctor } = await import('./doctor.js');
    await runDoctor();
  });

program
  .command('demo')
  .description('Run an interactive demo showing token savings in action')
  .action(async () => {
    const { runDemo } = await import('./demo.js');
    await runDemo();
  });

program
  .command('config')
  .description('Validate and optionally migrate eidos.config.json')
  .option('--fix', 'Auto-fix deprecated keys and missing required fields')
  .action(async (opts: { fix?: boolean }) => {
    const { validateConfig } = await import('./config_validate.js');
    const cfgPath = `${process.cwd()}/eidos.config.json`;
    validateConfig(cfgPath, opts.fix ?? false);
  });

const telemetryCmd = program
  .command('telemetry')
  .description('Manage opt-in telemetry (privacy-first, open-source)');

telemetryCmd
  .command('on')
  .description('Opt in to anonymous usage telemetry')
  .action(async () => {
    const { optInTelemetry } = await import('../engine/telemetry.js');
    optInTelemetry();
  });

telemetryCmd
  .command('off')
  .description('Opt out of telemetry')
  .action(async () => {
    const { optOutTelemetry } = await import('../engine/telemetry.js');
    optOutTelemetry();
  });

telemetryCmd
  .command('status')
  .description('Show telemetry opt-in status')
  .action(async () => {
    const { isTelemetryEnabled } = await import('../engine/telemetry.js');
    console.log(`[eidos] Telemetry: ${isTelemetryEnabled() ? 'enabled' : 'disabled'}`);
  });

program
  .command('dash')
  .description('Open the EidosCore web dashboard (http://localhost:7842)')
  .option('-p, --port <n>', 'Dashboard port', '7842')
  .action(async (opts: { port: string }) => {
    const { startDashboard } = await import('../dashboard/server.js');
    startDashboard(parseInt(opts.port, 10));
  });

program
  .command('sync')
  .description('Sync knowledge graph with shared folder or relay')
  .option('-f, --folder <path>', 'Shared folder path')
  .option('-r, --relay <url>', 'Relay server URL')
  .option('-k, --key <key>', 'Shared encryption key (or set EIDOS_SYNC_KEY env var)')
  .action(async (opts: { folder?: string; relay?: string; key?: string }) => {
    const { syncToFolder, syncToRelay } = await import('../sync/transport.js');
    const { getDb } = await import('../store/db.js');
    const db  = getDb();
    const key = opts.key ?? process.env['EIDOS_SYNC_KEY'] ?? '';
    if (!key) { console.error('[eidos] Provide --key or set EIDOS_SYNC_KEY env var'); process.exit(1); }
    if (opts.folder) { syncToFolder(db, process.cwd(), opts.folder, key); }
    else if (opts.relay) { await syncToRelay(db, process.cwd(), opts.relay, key); }
    else { console.error('[eidos] Provide --folder or --relay'); process.exit(1); }
  });

program
  .command('replay <session-id>')
  .description('Replay a conversation session in the terminal')
  .action(async (sessionId: string) => {
    const { replaySession } = await import('./replay.js');
    await replaySession(sessionId);
  });

program
  .command('branch <meso-block-id> [new-session-id]')
  .description('Fork a new session thread from a meso-block checkpoint')
  .action(async (mesoBlockId: string, newSessionId?: string) => {
    const { branchSession } = await import('./replay.js');
    await branchSession(mesoBlockId, newSessionId);
  });

program
  .command('nightly')
  .description('Run nightly maintenance jobs (SGD tuning + memory decay)')
  .action(async () => {
    const { runNightlyJobs } = await import('../tuner/nightly.js');
    await runNightlyJobs();
  });

program
  .command('setup')
  .description('Interactive first-time setup wizard (init + model download + doctor)')
  .action(async () => {
    const GREEN = '\x1b[32m'; const CYAN = '\x1b[36m'; const BOLD = '\x1b[1m';
    const RESET = '\x1b[0m';  const DIM  = '\x1b[2m';  const YELLOW = '\x1b[33m';

    console.log(`\n${BOLD}${CYAN}⚡ EidosCore Setup Wizard${RESET}`);
    console.log(`${DIM}  Setting up your workspace in ${process.cwd()}${RESET}\n`);

    // Step 1: init
    console.log(`${BOLD}Step 1/4${RESET}  Initialising workspace...`);
    const { initCommand } = await import('./init.js');
    await initCommand({ global: process.platform !== 'win32' });

    // Step 2: download model
    console.log(`\n${BOLD}Step 2/4${RESET}  Checking embedding model...`);
    const { isModelCached, getModelCacheDir, embed } = await import('../engine/embedding.js');
    if (isModelCached()) {
      console.log(`  ${GREEN}✔${RESET} Model already cached at ${getModelCacheDir()}`);
    } else {
      console.log(`  ${CYAN}⬇${RESET}  Downloading all-MiniLM-L6-v2 (~22 MB, one-time)...`);
      await embed('setup warm-up');
      console.log(`  ${GREEN}✔${RESET} Model cached at ${getModelCacheDir()}`);
    }

    // Step 3: doctor
    console.log(`\n${BOLD}Step 3/4${RESET}  Running health checks...`);
    const { runDoctor } = await import('./doctor.js');
    await runDoctor();

    // Step 4: next steps
    console.log(`${BOLD}Step 4/4${RESET}  ${GREEN}You're ready!${RESET}\n`);
    console.log(`${BOLD}  Quick-start commands:${RESET}`);
    console.log(`    ${CYAN}eidos demo${RESET}                  ${DIM}See memory injection in action${RESET}`);
    console.log(`    ${CYAN}eidos wrap claude "your question"${RESET}  ${DIM}Ask Claude with full memory${RESET}`);
    console.log(`    ${CYAN}eidos stats${RESET}                 ${DIM}View token savings dashboard${RESET}`);
    console.log(`    ${CYAN}eidos mcp print-config${RESET}      ${DIM}Get config snippet for Claude Desktop${RESET}`);
    console.log(`\n  ${YELLOW}Tip:${RESET} Add ${CYAN}--global${RESET} to wrap all AI CLIs automatically:`);
    console.log(`    ${CYAN}eidos init --global && source ~/.bashrc${RESET}\n`);
  });

program
  .command('download-model')
  .description('Pre-download the embedding model (~22 MB) so it is cached for offline use')
  .action(async () => {
    const { isModelCached, getModelCacheDir, embed } = await import('../engine/embedding.js');
    const GREEN = '\x1b[32m'; const CYAN = '\x1b[36m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';
    const cacheDir = getModelCacheDir();
    if (isModelCached()) {
      console.log(`\n${GREEN}${BOLD}✔ Embedding model already cached at:${RESET}\n  ${cacheDir}\n`);
      return;
    }
    console.log(`\n${CYAN}${BOLD}⬇  Downloading all-MiniLM-L6-v2 (~22 MB)...${RESET}`);
    console.log(`${RESET}  Cache: ${cacheDir}\n`);
    try {
      await embed('warm up');
      console.log(`\n${GREEN}${BOLD}✔ Model downloaded and cached successfully.${RESET}`);
      console.log(`  Future runs will load instantly from: ${cacheDir}\n`);
    } catch (err) {
      console.error(`\n\x1b[31mDownload failed: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
      process.exit(1);
    }
  });

program
  .command('version')
  .description('Show EidosCore version and component status')
  .action(async () => {
    const { createRequire } = await import('module');
    const _req = createRequire(import.meta.url);
    const GREEN = '\x1b[32m'; const CYAN = '\x1b[36m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m'; const DIM = '\x1b[2m';
    let version = '0.1.0';
    try {
      const pkg = _req('../../../package.json') as { version: string };
      version = pkg.version;
    } catch { /* use default */ }
    console.log(`\n${BOLD}${CYAN}⚡ EidosCore${RESET}  v${version}`);
    console.log(`${DIM}  Universal AI Memory & Token Efficiency Engine${RESET}`);
    console.log(`\n  ${GREEN}✔${RESET} Node.js       ${process.version}`);
    console.log(`  ${GREEN}✔${RESET} Platform      ${process.platform} ${process.arch}`);
    console.log(`  ${GREEN}✔${RESET} Package       eidos-memory@${version}`);
    console.log(`\n  ${DIM}Run \`eidos doctor\` for full health check${RESET}\n`);
  });

program
  .command('update')
  .description('Check for updates and show how to upgrade')
  .action(async () => {
    const { execSync } = await import('child_process');
    const { createRequire } = await import('module');
    const _req = createRequire(import.meta.url);
    const GREEN = '\x1b[32m'; const YELLOW = '\x1b[33m'; const CYAN = '\x1b[36m';
    const BOLD = '\x1b[1m'; const RESET = '\x1b[0m'; const DIM = '\x1b[2m';
    let current = '0.1.0';
    try { current = (_req('../../../package.json') as { version: string }).version; } catch { /* ok */ }
    console.log(`\n${BOLD}${CYAN}⚡ EidosCore Update Check${RESET}\n`);
    console.log(`  Installed:  v${current}`);
    // Check if there's a newer version on npm
    try {
      const latest = execSync('npm info eidos-memory version 2>/dev/null', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (latest && latest !== current) {
        console.log(`  ${YELLOW}Latest:     v${latest} — update available!${RESET}`);
        console.log(`\n  To upgrade:\n    ${CYAN}npm install -g eidos-memory${RESET}\n`);
      } else if (latest === current) {
        console.log(`  ${GREEN}Latest:     v${latest} — you are up to date ✔${RESET}\n`);
      } else {
        throw new Error('no npm version');
      }
    } catch {
      // Not on npm yet — show source update path
      console.log(`  ${DIM}(eidos-memory is not yet published to npm)${RESET}`);
      console.log(`\n  To update from source:`);
      console.log(`    ${CYAN}git pull && npm run build && npm install -g .${RESET}\n`);
    }
  });

// Tab-completion support (run: eidos --install-completion)
program.enablePositionalOptions();

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error('[eidos] Fatal error:', err);
  process.exit(1);
});
