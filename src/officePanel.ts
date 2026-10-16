// The office webview: a single editor-tab panel that mirrors the provider's session state
// into a 2D world. It creates no scanner, watcher or timer of its own — everything is
// driven by the provider's existing refresh cycle, so a closed office costs nothing.

import * as vscode from 'vscode';
import { buildSnapshot } from './officeSnapshot';
import { RecentEntryStore } from './recentEntries';
import { SubagentTranscriptReader, subagentTranscriptPath } from './subagentTranscriptReader';
import { logDebug } from './logger';
import type { SessionTreeDataProvider } from './sessionTreeDataProvider';
import type { ToExtension, ToWebview } from './officeTypes';
import type { Session } from './types';

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
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist'),
        vscode.Uri.joinPath(context.extensionUri, 'resources'),
      ],
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
    for (const session of sessions) {
      if (session.status !== 'working') {
        continue;
      }
      this.readTranscript(session.id, session.logFilePath);
      for (const subagent of session.subagents) {
        // Only working ones: a finished transcript cannot produce a new action, and reading
        // every completed one would multiply I/O by the session's whole history.
        if (subagent.status === 'working') {
          const agentId = subagent.agentId ?? subagent.id;
          this.readTranscript(subagent.id, subagentTranscriptPath(session.logFilePath, agentId));
        }
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
    const assets = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'office'));
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
  html, body { margin: 0; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }
  #office { position: relative; width: 100%; height: 100%; }
</style>
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
