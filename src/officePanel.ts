// The office webview: a single editor-tab panel that mirrors the provider's session state
// into a 2D world. It creates no scanner, watcher or timer of its own — everything is
// driven by the provider's existing refresh cycle, so a closed office costs nothing.

import * as vscode from 'vscode';
import { buildSnapshot } from './officeSnapshot';
import { RecentEntryStore } from './recentEntries';
import { SubagentTranscriptReader, workingTranscripts } from './subagentTranscriptReader';
import { logDebug } from './logger';
import type { SessionTreeDataProvider } from './sessionTreeDataProvider';
import type { ToExtension, ToWebview } from './officeTypes';
import type { Session } from './types';

// Overlay styles use VS Code theme variables so the office follows the active theme.
const OFFICE_CSS = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }
  /* flow-root: Phaser centres the canvas with margins, which would otherwise collapse through
     the parent and shift the whole overlay coordinate space. */
  #office { position: relative; display: flow-root; width: 100%; height: 100%; }
  .bubble {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 3;
    max-width: 220px;
    padding: 2px 8px;
    font: 11px var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .name-tag {
    position: absolute;
    z-index: 2;
    top: 0;
    left: 0;
    pointer-events: none;
    padding: 0 4px;
    border-radius: 4px;
    font: 10px var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent);
    white-space: nowrap;
  }
  .feed {
    position: absolute;
    z-index: 10;
    box-sizing: border-box;
    top: 0;
    right: 0;
    width: 380px;
    height: 100%;
    overflow-y: auto;
    padding: 12px;
    background: var(--vscode-sideBar-background);
    border-left: 1px solid var(--vscode-editorWidget-border);
    color: var(--vscode-editor-foreground);
    font: 12px var(--vscode-font-family);
  }
  .feed-list pre {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 4px 0 12px;
  }
  .feed-meta {
    opacity: 0.65;
    font-size: 10px;
    text-transform: uppercase;
  }
  .overflow {
    position: absolute;
    z-index: 5;
    left: 8px;
    bottom: 8px;
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font: 11px var(--vscode-font-family);
  }
  .hidden {
    display: none;
  }
  #office canvas {
    display: block;
  }
`;

export class OfficePanel {
  private static current: OfficePanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly entries = new RecentEntryStore();
  private readonly reader = new SubagentTranscriptReader();
  private readonly actions = new Map<string, string>();
  private openFeedAgentId: string | undefined;
  private webviewReady = false;

  static show(context: vscode.ExtensionContext, provider: SessionTreeDataProvider): void {
    if (OfficePanel.current) {
      OfficePanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel('agentville.office', 'AgentVille', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: false,
      // dist/ holds both the webview bundle and the office art (copied by esbuild.js).
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    });
    OfficePanel.current = new OfficePanel(panel, context, provider);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly provider: SessionTreeDataProvider,
  ) {
    panel.webview.html = this.html(context.extensionUri);

    this.disposables.push(
      panel.onDidDispose(() => {
        this.dispose();
      }),
      panel.webview.onDidReceiveMessage((message: ToExtension) => {
        this.onMessage(message);
      }),
      provider.onDidChangeSessions(() => {
        this.push();
      }),
      panel.onDidChangeViewState(() => {
        this.onViewState();
      }),
    );
  }

  private onViewState(): void {
    if (this.panel.visible) {
      this.push();
    } else {
      // The webview (and its side panel) is destroyed while hidden.
      this.openFeedAgentId = undefined;
    }
  }

  private onMessage(message: ToExtension): void {
    switch (message.type) {
      case 'ready':
        this.webviewReady = true;
        this.push();
        return;
      case 'openFeed':
        this.openFeedAgentId = message.agentId;
        this.pushFeed();
        return;
      case 'closeFeed':
        this.openFeedAgentId = undefined;
        return;
      case 'openLog':
        void vscode.commands.executeCommand('agentville.openSessionLog', this.itemFor(message.agentId));
        return;
      case 'openProject':
        void vscode.commands.executeCommand('agentville.openProject', this.itemFor(message.agentId));
        return;
    }
  }

  private itemFor(agentId: string): { session: Session } | undefined {
    const session = this.provider.getSessions().find((s) => s.id === agentId);
    return session ? { session } : undefined;
  }

  private post(message: ToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  /** Refresh actions from live transcripts, then post a full snapshot. No work while hidden. */
  private push(): void {
    if (!this.webviewReady || !this.panel.visible) {
      return;
    }
    if (!vscode.workspace.getConfiguration('agentville').get<boolean>('enabled', true)) {
      this.post({ type: 'monitoringDisabled' });
      return;
    }
    try {
      const sessions = this.provider.getSessions();
      this.refreshActions(sessions);
      const { agents, truncated } = buildSnapshot(sessions, this.actions);
      this.entries.retain(agents.map((a) => a.id));
      this.post({ type: 'snapshot', agents, truncated });
      this.pushFeed();
    } catch (error) {
      logDebug(`OfficePanel.push failed: ${String(error)}`);
    }
  }

  private refreshActions(sessions: readonly Session[]): void {
    // Only working agents are read: a finished transcript cannot produce a new action, and
    // reading every completed one would multiply I/O by the session's whole history.
    const working = new Set<string>();
    for (const { id, path } of sessions.flatMap(workingTranscripts)) {
      working.add(id);
      this.readTranscript(id, path);
    }
    // Nor do they keep one: an agent that resumes must not show the action it stopped on.
    for (const id of this.actions.keys()) {
      if (!working.has(id)) {
        this.actions.delete(id);
      }
    }
  }

  private readTranscript(id: string, transcriptPath: string): void {
    const result = this.reader.read(transcriptPath);
    if (result.action) {
      this.actions.set(id, result.action);
    }
    for (const entry of result.entries) {
      this.entries.push(id, entry);
    }
  }

  private pushFeed(): void {
    const agentId = this.openFeedAgentId;
    if (agentId) {
      this.post({ type: 'feed', agentId, entries: this.entries.get(agentId) });
    }
  }

  private html(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
    const assets = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'office'));
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64').slice(0, 32);
    // Phaser's WebGL renderer needs blob: for its shaders, and its loader fetches images over
    // XHR from the extension resource root. No remote origin is allowed.
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} blob: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' blob:`,
      `connect-src ${webview.cspSource} blob:`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>AgentVille</title>
<style>
${OFFICE_CSS}</style>
</head>
<body>
<div id="office" data-assets="${assets.toString()}"></div>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    OfficePanel.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panel.dispose();
  }
}
