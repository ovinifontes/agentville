// src/webview/main.ts
// Wires the three layers together: messages from the extension feed the renderer, the
// renderer reports screen positions to the bubbles, and bubble clicks ask the extension
// for that agent's feed.

import { createOffice } from './render/officeScene';
import { BubbleLayer } from './ui/bubbles';
import { NameTagLayer } from './ui/nameTags';
import { FeedPanel } from './ui/feedPanel';
import type { AgentView, ToExtension, ToWebview } from '../officeTypes';

declare function acquireVsCodeApi(): { postMessage(message: ToExtension): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('office');
if (!root) {
  throw new Error('office root element missing');
}

const assetsBaseUri = root.dataset.assets ?? '';
let agents: AgentView[] = [];

const feed = new FeedPanel(root, () => {
  vscode.postMessage({ type: 'closeFeed' });
});
const bubbles = new BubbleLayer(root, (agentId) => {
  const agent = agents.find((a) => a.id === agentId);
  feed.open(agentId, agent?.name ?? agentId);
  vscode.postMessage({ type: 'openFeed', agentId });
});

const nameTags = new NameTagLayer(root);

const scene = createOffice(root, assetsBaseUri);
scene.onCharacterPositions((positions) => {
  nameTags.render(positions, scene.zoom);
  bubbles.render(positions);
});

const overflow = document.createElement('div');
overflow.className = 'overflow hidden';
root.appendChild(overflow);

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'snapshot':
      agents = message.agents;
      scene.setActive(true);
      scene.setAgents(message.agents);
      overflow.textContent = message.truncated > 0 ? `+${message.truncated} waiting` : '';
      overflow.classList.toggle('hidden', message.truncated === 0);
      return;
    case 'feed':
      feed.render(message.agentId, message.entries);
      return;
    case 'monitoringDisabled':
      // Static disabled state (spec §9): no feed, no characters, no frame loop.
      feed.close();
      scene.setActive(false);
      overflow.textContent = 'Monitoring is disabled.';
      overflow.classList.remove('hidden');
      return;
  }
});

vscode.postMessage({ type: 'ready' });
