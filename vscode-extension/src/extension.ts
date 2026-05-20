import * as vscode from 'vscode';
import * as http from 'http';

// ── Memory Tree Provider ──────────────────────────────────────────────────────

interface MemoryNode {
  id: string;
  type: string;
  label: string;
  importance: number;
  children?: MemoryNode[];
}

class MemoryTreeItem extends vscode.TreeItem {
  constructor(public readonly node: MemoryNode) {
    super(node.label, node.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.description     = `[${node.type}] ${(node.importance * 100).toFixed(0)}%`;
    this.tooltip         = `${node.type}: ${node.label} (importance: ${node.importance.toFixed(2)})`;
    this.iconPath        = new vscode.ThemeIcon(
      node.type === 'chunk' ? 'symbol-function' :
      node.type === 'decision' ? 'bookmark' :
      node.type === 'error_memory' ? 'bug' :
      node.type === 'meso_block' ? 'history' : 'database',
    );
  }
}

class MemoryTreeProvider implements vscode.TreeDataProvider<MemoryNode> {
  private _onDidChange = new vscode.EventEmitter<MemoryNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _nodes: MemoryNode[] = [];

  refresh(nodes: MemoryNode[]): void {
    this._nodes = nodes;
    this._onDidChange.fire();
  }

  getTreeItem(element: MemoryNode): vscode.TreeItem { return new MemoryTreeItem(element); }

  getChildren(element?: MemoryNode): MemoryNode[] {
    if (!element) return this._nodes;
    return element.children ?? [];
  }
}

interface PrefetchParams {
  files: string[];
  session_id: string;
}

function getMcpPort(): number {
  return vscode.workspace.getConfiguration('eidosCore').get<number>('mcpPort', 3742);
}

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration('eidosCore').get<boolean>('enabled', true);
}

function sendMcpRequest(method: string, params: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const body = Buffer.from(JSON.stringify({
    jsonrpc: '2.0', id: Date.now(), method, params,
  }));
  const req = http.request({
    hostname: 'localhost', port: getMcpPort(),
    path: '/mcp', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
  });
  req.on('error', () => { /* silent — MCP server may not be running */ });
  req.write(body);
  req.end();
}

function prefetchFile(filePath: string): void {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const relative = filePath.startsWith(wsFolder) ? filePath.slice(wsFolder.length + 1) : filePath;
  const sessionId = vscode.env.sessionId;

  sendMcpRequest('tools/call', {
    name: 'prefetch',
    arguments: { files: [relative], session_id: sessionId } as PrefetchParams,
  });
}

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPrefetch(filePath: string, ms = 500): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => prefetchFile(filePath), ms);
}

// ── Auto-start daemon ─────────────────────────────────────────────────────────

function ensureEidosDaemon(port: number): void {
  const { exec, spawn } = require('child_process') as typeof import('child_process');
  exec('eidos mcp pid', (_err: Error | null, stdout: string) => {
    if (stdout.trim()) return; // already running
    const child = spawn('eidos', ['daemon', 'start', '--mcp', String(port), '--dash', String(port + 100)], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.unref();
  });
}

// ── Session savings tracker ───────────────────────────────────────────────────

let _sessionTokensSaved = 0;
let _statusBar: vscode.StatusBarItem | null = null;

function updateSavings(tokensSaved: number): void {
  _sessionTokensSaved += tokensSaved;
  if (_statusBar) {
    _statusBar.text = `$(database) eidos ~${(_sessionTokensSaved / 1000).toFixed(1)}k saved`;
    _statusBar.tooltip = `EidosCore: ~${_sessionTokensSaved.toLocaleString()} tokens saved this session`;
  }
}

function apiGet<T>(port: number, urlPath: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port, path: urlPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString()) as T); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export function activate(context: vscode.ExtensionContext): void {
  // ── Ensure daemon is running ─────────────────────────────────────────────
  ensureEidosDaemon(getMcpPort());

  // ── Memory Tree View ────────────────────────────────────────────────────────
  const treeProvider = new MemoryTreeProvider();
  const treeView = vscode.window.createTreeView('eidosMemoryTree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  async function refreshTree(): Promise<void> {
    try {
      const dashPort = getMcpPort() + 100;
      const data = await apiGet<{ nodes: MemoryNode[] }>(dashPort, '/api/graph');
      // Group by type
      const byType = new Map<string, MemoryNode[]>();
      for (const n of data.nodes) {
        const arr = byType.get(n.type) ?? [];
        arr.push(n);
        byType.set(n.type, arr);
      }
      const roots: MemoryNode[] = Array.from(byType.entries()).map(([type, nodes]) => ({
        id: `group:${type}`, type: 'group', label: `${type} (${nodes.length})`,
        importance: 1, children: nodes.sort((a, b) => b.importance - a.importance).slice(0, 30),
      }));
      treeProvider.refresh(roots);

      // Also update savings
      const stats = await apiGet<{ tokensSaved: number }>(dashPort, '/api/stats');
      _sessionTokensSaved = stats.tokensSaved;
      if (_statusBar) {
        _statusBar.text = `$(database) eidos ~${(_sessionTokensSaved / 1000).toFixed(1)}k saved`;
      }
    } catch { /* dashboard may not be running */ }
  }

  // 1. Prefetch on file open
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
      if (editor?.document.uri.scheme === 'file') {
        debouncedPrefetch(editor.document.uri.fsPath);
        void refreshTree();
      }
    }),
  );

  // 2. Prefetch on cursor move (throttled to once per 2s)
  let _cursorTimer: ReturnType<typeof setTimeout> | null = null;
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
      if (e.textEditor.document.uri.scheme !== 'file') return;
      if (_cursorTimer) return;
      _cursorTimer = setTimeout(() => {
        _cursorTimer = null;
        debouncedPrefetch(e.textEditor.document.uri.fsPath, 0);
      }, 2000);
    }),
  );

  // 3. Prefetch on build error (task end with error)
  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess((e: vscode.TaskProcessEndEvent) => {
      if (e.exitCode !== 0) {
        const editor = vscode.window.activeTextEditor;
        if (editor) debouncedPrefetch(editor.document.uri.fsPath, 0);
      }
    }),
  );

  // 4. Manual prefetch command
  context.subscriptions.push(
    vscode.commands.registerCommand('eidos.prefetch', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        prefetchFile(editor.document.uri.fsPath);
        vscode.window.setStatusBarMessage('[eidos] Prefetch sent', 2000);
        void refreshTree();
      }
    }),
  );

  // 5. Open dashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand('eidos.openDashboard', () => {
      const port = getMcpPort() + 100;
      void vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
    }),
  );

  // 6. Refresh tree command
  context.subscriptions.push(
    vscode.commands.registerCommand('eidos.refreshTree', () => { void refreshTree(); }),
  );

  // 7. "Show what Eidos knows about this file" command
  context.subscriptions.push(
    vscode.commands.registerCommand('eidos.showFileKnowledge', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('Open a file first.');
        return;
      }
      const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const filePath = editor.document.uri.fsPath;
      const relative = filePath.startsWith(wsFolder) ? filePath.slice(wsFolder.length + 1) : filePath;

      try {
        const dashPort = getMcpPort() + 100;
        const data = await apiGet<{ nodes: MemoryNode[] }>(dashPort, '/api/graph');
        const related = data.nodes.filter(n =>
          (n.label.includes(relative.replace(/\\/g, '/').split('/').pop() ?? '')) ||
          n.type === 'file',
        ).slice(0, 10);

        if (related.length === 0) {
          void vscode.window.showInformationMessage(`[eidos] No memory nodes found for ${relative}`);
          return;
        }

        const items = related.map(n => `• [${n.type}] ${n.label} (importance: ${n.importance.toFixed(2)})`);
        const panel = vscode.window.createWebviewPanel(
          'eidosFileKnowledge', `Eidos: ${relative.split(/[\\/]/).pop()}`,
          vscode.ViewColumn.Beside, {},
        );
        panel.webview.html = `<!DOCTYPE html><html><body style="font-family:monospace;padding:16px;background:#0f1117;color:#e2e8f0">
          <h2 style="color:#6366f1">⚡ EidosCore knows about <code>${relative}</code></h2>
          <ul>${items.map(i => `<li style="margin:6px 0">${i}</li>`).join('')}</ul>
        </body></html>`;
      } catch {
        void vscode.window.showWarningMessage('[eidos] Dashboard not running. Start it with: eidos dash');
      }
    }),
  );

  // Status bar — live token savings
  _statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  _statusBar.text = '$(database) eidos';
  _statusBar.tooltip = 'EidosCore Memory — click to open dashboard';
  _statusBar.command = 'eidos.openDashboard';
  _statusBar.show();
  context.subscriptions.push(_statusBar);

  // Initial tree refresh
  void refreshTree();
}

export function deactivate(): void {
  _statusBar = null;
}
