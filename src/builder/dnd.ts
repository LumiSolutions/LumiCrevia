import type { BlockNode } from "../validation.js";
import { acceptsChildren } from "./blocks.js";
import { canDrop, type DropPlacement, findBlock } from "./tree.js";

export type DropKind = "canvas" | "block" | "container";

export type PointerRect = {
  top: number;
  height: number;
};

export type DropIndicator = {
  overId: string;
  edge: "before" | "after" | "inside";
  placement: DropPlacement;
};

function edgeFromPointer(pointerY: number, rect: PointerRect): "before" | "after" | "inside" {
  if (rect.height <= 0) {
    return "inside";
  }

  const ratio = (pointerY - rect.top) / rect.height;

  if (ratio < 0.28) {
    return "before";
  }

  if (ratio > 0.72) {
    return "after";
  }

  return "inside";
}

export function resolvePointerDrop(input: {
  tree: BlockNode[];
  draggingId: string;
  overId: string | null;
  overKind: DropKind | null;
  pointerY: number;
  overRect: PointerRect | null;
}): { ok: true; indicator: DropIndicator } | { ok: false; reason: "invalid" } {
  if (!input.overId || !input.overKind) {
    return { ok: false, reason: "invalid" };
  }

  if (input.overKind === "canvas") {
    const placement = { parentId: null, index: input.tree.length };
    return canDrop(input.tree, input.draggingId, placement)
      ? { ok: true, indicator: { overId: input.overId, edge: "inside", placement } }
      : { ok: false, reason: "invalid" };
  }

  const over = findBlock(input.tree, input.overId);

  if (!over) {
    return { ok: false, reason: "invalid" };
  }

  const parent = findParentIndex(input.tree, input.overId);
  const edge = input.overRect ? edgeFromPointer(input.pointerY, input.overRect) : "after";
  let placement: DropPlacement;

  if (input.overKind === "container" && (edge === "inside" || acceptsChildren(over.type))) {
    if (edge === "inside") {
      placement = { parentId: over.id, index: over.children.length };
    } else if (edge === "before") {
      placement = { parentId: parent.parentId, index: parent.index };
    } else {
      placement = { parentId: parent.parentId, index: parent.index + 1 };
    }
  } else if (edge === "before") {
    placement = { parentId: parent.parentId, index: parent.index };
  } else {
    placement = { parentId: parent.parentId, index: parent.index + 1 };
  }

  if (!canDrop(input.tree, input.draggingId, placement)) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    indicator: { overId: input.overId, edge: edge === "inside" && !acceptsChildren(over.type) ? "after" : edge, placement },
  };
}

function findParentIndex(
  nodes: BlockNode[],
  id: string,
  parentId: string | null = null,
): { parentId: string | null; index: number } {
  const index = nodes.findIndex((node) => node.id === id);

  if (index !== -1) {
    return { parentId, index };
  }

  for (const node of nodes) {
    const nested = findParentIndex(node.children, id, node.id);

    if (nested.index !== -1 || node.children.some((child) => child.id === id || findBlock([child], id))) {
      const childIndex = node.children.findIndex((child) => child.id === id);

      if (childIndex !== -1) {
        return { parentId: node.id, index: childIndex };
      }

      if (findBlock(node.children, id)) {
        return findParentIndex(node.children, id, node.id);
      }
    }
  }

  return { parentId: null, index: -1 };
}
