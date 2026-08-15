import { useCallback, useSyncExternalStore } from "react";

export function normalizeCanonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const UUID_RE = /^[0-9a-f-]{32,36}$/i;

export type CortexViewMode = "core" | "document";

export interface CortexBridgeState {
  highlightedIds: string[];
  focusedId: string | null;
  selectedId: string | null;
  retrieving: boolean;
  pulseIds: string[];
  idByCanonical: Map<string, string>;
  viewMode: CortexViewMode;
  selectedDocumentId: string | null;
  coreExpanded: boolean;
}

type Listener = () => void;

let state: CortexBridgeState = {
  highlightedIds: [],
  focusedId: null,
  selectedId: null,
  retrieving: false,
  pulseIds: [],
  idByCanonical: new Map(),
  viewMode: "core",
  selectedDocumentId: null,
  coreExpanded: false,
};

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<CortexBridgeState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CortexBridgeState {
  return state;
}

export function useCortexBridge() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const highlight = useCallback((ids: string[]) => setState({ highlightedIds: ids }), []);
  const clearHighlight = useCallback(() => setState({ highlightedIds: [] }), []);
  const focus = useCallback(
    (bucketId: string | null) => setState({ focusedId: bucketId }),
    []
  );
  const select = useCallback(
    (bucketId: string | null) => setState({ selectedId: bucketId }),
    []
  );
  const setRetrieving = useCallback(
    (retrieving: boolean) => setState({ retrieving }),
    []
  );
  const pulse = useCallback((ids: string[]) => {
    setState({ pulseIds: [] });
    requestAnimationFrame(() => setState({ pulseIds: ids }));
  }, []);
  const setIdMap = useCallback(
    (map: Map<string, string>) => setState({ idByCanonical: map }),
    []
  );
  const setViewMode = useCallback(
    (viewMode: CortexViewMode) => setState({ viewMode }),
    []
  );
  const selectDocument = useCallback(
    (documentId: string | null) => setState({ selectedDocumentId: documentId }),
    []
  );
  const openDocument = useCallback((documentId: string) => {
    setState({
      viewMode: "document",
      selectedDocumentId: documentId,
      selectedId: null,
      focusedId: null,
      highlightedIds: [],
      coreExpanded: false,
    });
  }, []);
  const closeDocument = useCallback(() => {
    setState({
      viewMode: "core",
      selectedDocumentId: null,
      selectedId: null,
      focusedId: null,
      highlightedIds: [],
      coreExpanded: false,
    });
  }, []);
  const expandCore = useCallback(() => {
    setState({
      coreExpanded: true,
      selectedId: null,
      focusedId: null,
      highlightedIds: [],
    });
  }, []);
  const collapseCore = useCallback(() => {
    setState({
      coreExpanded: false,
      selectedId: null,
      focusedId: null,
      highlightedIds: [],
    });
  }, []);
  const resolveId = useCallback(
    (value: string | null | undefined): string | null => {
      if (!value) return null;
      const map = snapshot.idByCanonical;
      if (map.has(value)) return map.get(value) ?? null;
      const normalized = normalizeCanonical(value);
      if (map.has(normalized)) return map.get(normalized) ?? null;
      if (UUID_RE.test(value)) return value;
      return null;
    },
    [snapshot.idByCanonical]
  );
  const reset = useCallback(
    () =>
      setState({
        highlightedIds: [],
        focusedId: null,
        selectedId: null,
        retrieving: false,
        pulseIds: [],
        viewMode: "core",
        selectedDocumentId: null,
        coreExpanded: false,
      }),
    []
  );

  return {
    ...snapshot,
    highlight,
    clearHighlight,
    focus,
    select,
    setRetrieving,
    pulse,
    setIdMap,
    resolveId,
    reset,
    setViewMode,
    selectDocument,
    openDocument,
    closeDocument,
    expandCore,
    collapseCore,
  };
}
