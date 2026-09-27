import { inspectSnapshot, type SiteSnapshot } from "../validation.js";
import { createHistory, pushHistory, redoHistory, undoHistory, type HistoryState } from "./history.js";

export type EditorSaveState = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type EditorDocument = {
  snapshot: SiteSnapshot;
  pageId: string;
  selectedBlockId: string | null;
  viewport: "desktop" | "tablet" | "mobile";
};

export type EditorSession = {
  document: EditorDocument;
  history: HistoryState<EditorDocument>;
  saveState: EditorSaveState;
  expectedVersion: number;
  error: string | null;
  conflictVersion: number | null;
};

export function createEditorSession(snapshot: SiteSnapshot, expectedVersion: number): EditorSession {
  const pageId = snapshot.pages.find((page) => page.homepage)?.id ?? snapshot.pages[0]?.id ?? "";
  const document: EditorDocument = {
    snapshot,
    pageId,
    selectedBlockId: null,
    viewport: "desktop",
  };

  return {
    document,
    history: createHistory(document),
    saveState: "clean",
    expectedVersion,
    error: null,
    conflictVersion: null,
  };
}

export function commitDocument(session: EditorSession, document: EditorDocument): EditorSession {
  return {
    ...session,
    document,
    history: pushHistory(session.history, document),
    saveState: session.saveState === "conflict" ? "conflict" : "dirty",
    error: null,
  };
}

export function undoEditor(session: EditorSession): EditorSession {
  const history = undoHistory(session.history);

  if (history === session.history) {
    return session;
  }

  return { ...session, history, document: history.present, saveState: "dirty" };
}

export function redoEditor(session: EditorSession): EditorSession {
  const history = redoHistory(session.history);

  if (history === session.history) {
    return session;
  }

  return { ...session, history, document: history.present, saveState: "dirty" };
}

export function markSaving(session: EditorSession): EditorSession {
  return { ...session, saveState: "saving", error: null };
}

export function markSaved(session: EditorSession, version: number): EditorSession {
  return {
    ...session,
    saveState: "saved",
    expectedVersion: version,
    conflictVersion: null,
    error: null,
  };
}

export function markClean(session: EditorSession): EditorSession {
  return { ...session, saveState: "clean" };
}

export function markConflict(session: EditorSession, currentVersion: number): EditorSession {
  return { ...session, saveState: "conflict", conflictVersion: currentVersion, error: "This site changed elsewhere" };
}

export function markError(session: EditorSession, error: string): EditorSession {
  return { ...session, saveState: "error", error };
}

export function validateEditorSnapshot(snapshot: SiteSnapshot) {
  return inspectSnapshot(snapshot);
}
