// The office webview: a single editor-tab panel that mirrors the provider's session state
// into a 2D world. It creates no scanner, watcher or timer of its own — everything is
// driven by the provider's existing refresh cycle, so a closed office costs nothing.

import * as vscode from 'vscode';
import { buildSnapshot } from './officeSnapshot';
import { RecentEntryStore } from './recentEntries';
import { SubagentTranscriptReader, workingTranscripts } from './subagentTranscriptReader';
import { logDebug } from './logger';
import type { ProgressStore } from './progressStore';
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
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Raise and enlarge the bubble under the pointer or keyboard focus above its neighbours, still
     below the overflow chip (z 5) and the feed (z 10). The position is the inline translate
     property, so scale grows upward from the anchor and the layout's cached size holds. */
  .bubble { transform-origin: 50% 100%; }
  .bubble:hover, .bubble:focus-visible { z-index: 4; scale: 1.3; }
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
  .team-button {
    position: absolute;
    z-index: 6;
    top: 8px;
    left: 8px;
    padding: 2px 6px;
    font-size: 14px;
    cursor: pointer;
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 6px;
  }
  /* Under the feed (z 10), which owns the right edge; scrolls when the lists are long. */
  .team-panel {
    position: absolute;
    z-index: 9;
    box-sizing: border-box;
    top: 40px;
    left: 8px;
    width: 300px;
    max-width: calc(100% - 16px);
    max-height: calc(100% - 100px);
    overflow-y: auto;
    padding: 4px 12px 12px;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 6px;
    color: var(--vscode-editor-foreground);
    font: 12px var(--vscode-font-family);
  }
  .team-panel h2 { font-size: 14px; margin: 8px 0 2px; }
  .team-panel h3 { font-size: 11px; margin: 12px 0 4px; text-transform: uppercase; opacity: 0.65; }
  .team-row { margin: 0 0 8px; }
  .team-row.locked { opacity: 0.5; }
  .team-meta { opacity: 0.7; font-size: 11px; }
  .team-bar { height: 4px; margin-top: 3px; border-radius: 2px; background: var(--vscode-editorWidget-border); }
  .team-bar > div { height: 100%; border-radius: 2px; background: var(--vscode-progressBar-background, var(--vscode-badge-background)); }
  .toasts {
    position: absolute;
    z-index: 8;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 260px;
    max-width: calc(100% - 120px);
    pointer-events: none;
  }
  .toast {
    padding: 6px 10px;
    border-radius: 8px;
    font: 11px var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
  }
  @media (prefers-reduced-motion: no-preference) {
    .toast { animation: toast-in 0.25s ease-out; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } }
  }
  .hidden {
    display: none;
  }
  #office canvas {
    display: block;
  }
`;

/** What the office mirrors: live sessions and office progression. */
export interface OfficeSources {
  provider: SessionTreeDataProvider;
  progress: ProgressStore;
}

export class OfficePanel {
  private static current: OfficePanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly entries = new RecentEntryStore();
  private readonly reader = new SubagentTranscriptReader();
  private readonly actions = new Map<string, string>();
  private openFeedAgentId: string | undefined;
  private webviewReady = false;
  private postedProgress = ''; // the last progress view this webview got, as JSON

  static show(context: vscode.ExtensionContext, sources: OfficeSources): void {
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
    OfficePanel.current = new OfficePanel(panel, context, sources);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly sources: OfficeSources,
  ) {
    panel.webview.html = this.html(context.extensionUri);

    this.disposables.push(
      panel.onDidDispose(() => {
        this.dispose();
      }),
      panel.webview.onDidReceiveMessage((message: ToExtension) => {
        this.onMessage(message);
      }),
      sources.provider.onDidChangeSessions(() => {
        this.push();
      }),
      sources.progress.onDidChange(() => {
        this.pushProgress();
      }),
      panel.onDidChangeViewState(() => {
        this.onViewState();
      }),
    );
  }

  private onViewState(): void {
    if (this.panel.visible) {
      this.push();
      this.pushProgress();
    } else {
      // The webview (and its side panel) is destroyed while hidden.
      this.openFeedAgentId = undefined;
      this.postedProgress = '';
    }
  }

  private onMessage(message: ToExtension): void {
    switch (message.type) {
      case 'ready':
        this.webviewReady = true;
        this.postedProgress = ''; // a new webview has nothing yet
        this.push();
        this.pushProgress();
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
      case 'achievementsShown':
        this.sources.progress.markToastsShown(message.ids);
        return;
    }
  }

  private itemFor(agentId: string): { session: Session } | undefined {
    const session = this.sources.provider.getSessions().find((s) => s.id === agentId);
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
      const sessions = this.sources.provider.getSessions();
      this.refreshActions(sessions);
      const { agents, truncated } = buildSnapshot(sessions, this.actions, this.sources.progress.current());
      const ids = agents.map((a) => a.id);
      // The open feed's agent keeps its last entries after it leaves, until the panel closes.
      this.entries.retain(this.openFeedAgentId ? [...ids, this.openFeedAgentId] : ids);
      this.post({ type: 'snapshot', agents, truncated });
      // A departed agent has nothing new to show; the webview keeps the last feed it got.
      if (this.openFeedAgentId && ids.includes(this.openFeedAgentId)) {
        this.pushFeed();
      }
    } catch (error) {
      logDebug(`OfficePanel.push failed: ${String(error)}`);
    }
  }

  /** Post the progress view when it changed. Like push(), never while hidden; independent of monitoring. */
  private pushProgress(): void {
    if (!this.webviewReady || !this.panel.visible) {
      return;
    }
    const progress = this.sources.progress.current();
    const key = JSON.stringify(progress);
    if (key !== this.postedProgress) {
      this.postedProgress = key;
      this.post({ type: 'progress', progress });
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
    // Phaser's loader fetches images over XHR from the extension resource root and hands them
    // to <img> as blob: URLs. Scripts need only the nonce: Phaser compiles its WebGL shaders
    // from strings, not blob: scripts, and both renderers load under this policy. No remote
    // origin is allowed.
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} blob: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
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
