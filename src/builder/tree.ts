import type { BlockNode } from "../validation.js";
import { acceptsChildren } from "./blocks.js";

export function findBlock(nodes: BlockNode[], id: string): BlockNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }

    const nested = findBlock(node.children, id);

    if (nested) {
      return nested;
    }
  }

  return null;
}

export function findParent(nodes: BlockNode[], id: string, parent: BlockNode | null = null): BlockNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return parent;
    }

    const nested = findParent(node.children, id, node);

    if (nested !== null || node.children.some((child) => child.id === id)) {
      return node.children.some((child) => child.id === id) ? node : nested;
    }
  }

  return null;
}

function containsId(node: BlockNode, id: string): boolean {
  if (node.id === id) {
    return true;
  }

  return node.children.some((child) => containsId(child, id));
}

export function removeBlock(nodes: BlockNode[], id: string): { nodes: BlockNode[]; removed: BlockNode | null } {
  const next: BlockNode[] = [];
  let removed: BlockNode | null = null;

  for (const node of nodes) {
    if (node.id === id) {
      removed = node;
      continue;
    }

    const child = removeBlock(node.children, id);
    next.push(child.removed ? { ...node, children: child.nodes } : node);
    removed ??= child.removed;
  }

  return { nodes: next, removed };
}

export type DropPlacement = {
  parentId: string | null;
  index: number;
};

export function canDrop(tree: BlockNode[], draggingId: string, placement: DropPlacement): boolean {
  const dragging = findBlock(tree, draggingId);

  if (!dragging) {
    if (placement.parentId) {
      const parent = findBlock(tree, placement.parentId);
      return Boolean(parent && acceptsChildren(parent.type));
    }

    return true;
  }

  if (placement.parentId === draggingId) {
    return false;
  }

  if (placement.parentId) {
    const parent = findBlock(tree, placement.parentId);

    if (!parent || !acceptsChildren(parent.type) || containsId(dragging, placement.parentId)) {
      return false;
    }
  }

  return true;
}

export function insertBlock(nodes: BlockNode[], block: BlockNode, placement: DropPlacement): BlockNode[] {
  if (!placement.parentId) {
    const next = [...nodes];
    next.splice(placement.index, 0, block);
    return next;
  }

  return nodes.map((node) => {
    if (node.id === placement.parentId) {
      const children = [...node.children];
      children.splice(placement.index, 0, block);
      return { ...node, children };
    }

    return { ...node, children: insertBlock(node.children, block, placement) };
  });
}

export function moveBlock(nodes: BlockNode[], draggingId: string, placement: DropPlacement): BlockNode[] | null {
  if (!canDrop(nodes, draggingId, placement)) {
    return null;
  }

  const stripped = removeBlock(nodes, draggingId);

  if (!stripped.removed) {
    return null;
  }

  let target = placement;

  if (!placement.parentId) {
    const fromIndex = nodes.findIndex((node) => node.id === draggingId);

    if (fromIndex !== -1 && fromIndex < placement.index) {
      target = { ...placement, index: Math.max(0, placement.index - 1) };
    }
  }

  return insertBlock(stripped.nodes, stripped.removed, target);
}

export function updateBlock(nodes: BlockNode[], id: string, mutate: (block: BlockNode) => BlockNode): BlockNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return mutate(node);
    }

    return { ...node, children: updateBlock(node.children, id, mutate) };
  });
}

export function flattenBlocks(nodes: BlockNode[], parentId: string | null = null): Array<{
  block: BlockNode;
  parentId: string | null;
  index: number;
}> {
  return nodes.flatMap((block, index) => [
    { block, parentId, index },
    ...flattenBlocks(block.children, block.id),
  ]);
}
