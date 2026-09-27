const DEFAULT_LIMIT = 50;

export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(state: HistoryState<T>, next: T, limit = DEFAULT_LIMIT): HistoryState<T> {
  const past = [...state.past, state.present];

  if (past.length > limit) {
    past.shift();
  }

  return { past, present: next, future: [] };
}

export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  const previous = state.past.at(-1);

  if (!previous) {
    return state;
  }

  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
}

export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  const next = state.future[0];

  if (!next) {
    return state;
  }

  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
