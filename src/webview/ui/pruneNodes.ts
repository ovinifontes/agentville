// Shared by the overlay layers: drop (and detach) the DOM nodes of characters that left.

export function pruneNodes(nodes: Map<string, HTMLElement>, alive: ReadonlySet<string>): void {
  for (const [id, node] of nodes) {
    if (!alive.has(id)) {
      node.remove();
      nodes.delete(id);
    }
  }
}
