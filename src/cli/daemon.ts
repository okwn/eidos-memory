import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { c } from './spinner.js';

const PID_FILE = path.join(os.homedir(), '.eidos', 'daemon.pid');
const LOG_FILE = path.join(os.homedir(), '.eidos', 'daemon.log');

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  mcpPort: number;
  proxyPort: number;
  dashPort: number;
}

export function readDaemonPid(): number | null {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    // Check if process is still alive
    process.kill(pid, 0); // throws if not alive
    return pid;
  } catch {
    // Stale PID — clean up
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    return null;
  }
}

export function getDaemonStatus(): DaemonStatus {
  const pid = readDaemonPid();
  return {
    running: pid !== null,
    pid: pid ?? undefined,
    mcpPort: 3742,
    proxyPort: 4141,
    dashPort: 7842,
  };
}

export async function startDaemon(opts: { mcp: number; proxy: number; dash: number }): Promise<void> {
  const existing = readDaemonPid();
  if (existing) {
    console.log(`${c.yellow('⚠')}  EidosCore daemon already running (PID ${existing})`);
    console.log(`    MCP   → localhost:${opts.mcp}`);
    console.log(`    Proxy → localhost:${opts.proxy}`);
    console.log(`    Dash  → http://localhost:${opts.dash}`);
    return;
  }

  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });

  // Build the daemon script inline — starts MCP (stdio via bridge), proxy, and dashboard
  const daemonScript = path.join(os.homedir(), '.eidos', 'daemon-runner.mjs');
  const eidosBin = process.argv[1] ?? 'eidos';
  const nodeExe  = process.execPath;

  fs.writeFileSync(daemonScript, `
import { createServer } from 'net';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

writeFileSync(${JSON.stringify(PID_FILE)}, String(process.pid));
process.title = 'eidos-daemon';

const env = { ...process.env, EIDOS_MCP_PORT: '${opts.mcp}', EIDOS_PROXY_PORT: '${opts.proxy}', EIDOS_DASH_PORT: '${opts.dash}' };

// Start proxy
const proxy = spawn(${JSON.stringify(nodeExe)}, [${JSON.stringify(eidosBin)}, 'proxy', '--port', '${opts.proxy}'], { detached: false, stdio: 'ignore', env });

// Start dashboard
const dash = spawn(${JSON.stringify(nodeExe)}, [${JSON.stringify(eidosBin)}, 'dash', '--port', '${opts.dash}'], { detached: false, stdio: 'ignore', env });

// MCP TCP bridge — wraps stdio MCP server over a TCP socket so VS Code can connect
const mcpBridge = createServer((socket) => {
  const mcp = spawn(${JSON.stringify(nodeExe)}, [${JSON.stringify(eidosBin)}, 'mcp'], { stdio: ['pipe','pipe','inherit'], env });
  socket.pipe(mcp.stdin);
  mcp.stdout.pipe(socket);
  socket.on('close', () => mcp.kill());
});
mcpBridge.listen(${opts.mcp}, '127.0.0.1');

process.on('SIGTERM', () => { proxy.kill(); dash.kill(); mcpBridge.close(); process.exit(0); });
process.on('SIGINT',  () => { proxy.kill(); dash.kill(); mcpBridge.close(); process.exit(0); });
`.trim());

  const child = spawn(nodeExe, [daemonScript], {
    detached: true,
    stdio: ['ignore', 'ignore', fs.openSync(LOG_FILE, 'a')],
  });
  child.unref();

  // Wait briefly for PID file to appear
  await new Promise<void>((resolve) => setTimeout(resolve, 600));

  const pid = readDaemonPid();
  console.log(`\n${c.bold(c.green('⚡ EidosCore daemon started'))}`);
  console.log(`   PID   ${c.bold(String(pid ?? child.pid ?? '?'))}`);
  console.log(`   MCP   ${c.cyan(`localhost:${opts.mcp}`)}`);
  console.log(`   Proxy ${c.cyan(`localhost:${opts.proxy}`)}`);
  console.log(`   Dash  ${c.cyan(`http://localhost:${opts.dash}`)}`);
  console.log(`   Log   ${c.dim(LOG_FILE)}\n`);
}

export function stopDaemon(): void {
  const pid = readDaemonPid();
  if (!pid) {
    console.log(`${c.yellow('·')} No daemon running.`);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    console.log(`${c.green('✔')} Daemon (PID ${pid}) stopped.`);
  } catch (e) {
    console.error(`${c.red('✖')} Could not stop daemon: ${e}`);
  }
}

export function daemonPid(): void {
  const status = getDaemonStatus();
  if (status.running) {
    process.stdout.write(String(status.pid) + '\n');
  } else {
    process.stdout.write('\n');
  }
}
