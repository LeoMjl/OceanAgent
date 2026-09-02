import type { ConversationNode } from "./api";

export interface TreeNode {
  node: ConversationNode;
  depth: number;
  hasBranch: boolean;
}

export function activeBranch(nodes: ConversationNode[], leafId: string | null): ConversationNode[] {
  if (!leafId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const branch: ConversationNode[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(leafId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return branch.reverse();
}

export function flattenTree(nodes: ConversationNode[]): TreeNode[] {
  const children = new Map<string | null, ConversationNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const flattened: TreeNode[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const siblings = children.get(parentId) ?? [];
    for (const node of siblings) {
      const descendants = children.get(node.id) ?? [];
      flattened.push({ node, depth, hasBranch: descendants.length > 1 });
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return flattened;
}

export function shortText(value: string, max = 42): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}
