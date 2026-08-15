import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CortexSearch } from "../components/cortex/CortexSearch";
import { CortexCanvas } from "../components/cortex/CortexCanvas";
import { MemoryInspector } from "../components/cortex/MemoryInspector";
import { GraphFilters } from "../components/cortex/GraphFilters";
import { NeuralSpinner } from "../components/shared/NeuralSpinner";
import { Icon } from "../components/shared/Icon";
import { api, normalizeRelationType } from "../api";
import { useCortexBridge, normalizeCanonical } from "../hooks/useCortexBridge";
import { useCortexMap } from "../hooks/useCortexMap";
import { useDebounce } from "../hooks/useDebounce";
import { createGraphNode, createGraphEdge } from "../cortex/types";
import type { GraphEdge, GraphNode, LayoutMode } from "../cortex/types";
import {
  ROUTES,
  STORAGE_KEYS,
  strengthCategory,
} from "../constants";
import { daysSince } from "../utils/date";
import type {
  ConceptType,
  MemorySummary,
  RelationshipType,
  StrengthCategory,
} from "../types";

type CortexNodeKind = "core" | "domain" | "document" | "concept";
type CortexSceneMode = "core" | "document" | "graph";
type CortexLinkFilter = "all" | "linked" | "islands";

interface CortexGraphNode extends GraphNode {
  kind?: CortexNodeKind;
  documentId?: string | null;
  conceptCount?: number;
  connectedConceptCount?: number;
  isolatedConceptCount?: number;
  relatedDocumentCount?: number;
  solo?: boolean;
  island?: boolean;
  expanded?: boolean;
  boxWidth?: number;
  boxHeight?: number;
}

interface CortexCoreLike {
  totalMemories?: number;
  averageStrength?: number;
  criticalCount?: number;
  documentCount?: number;
  totalRelationships?: number;
}

interface CortexRelatedDocumentLike {
  documentId?: string;
  filename?: string;
  sharedConcepts?: number;
}

interface CortexDocumentNodeLike {
  documentId: string;
  filename: string;
  fileType?: string;
  uploadedAt: string;
  conceptCount?: number;
  averageStrength?: number;
  criticalCount?: number;
  connectedConceptCount?: number;
  isolatedConceptCount?: number;
  relatedDocuments?: CortexRelatedDocumentLike[];
  topConcepts?: Array<{ bucketId?: string; canonical?: string }>;
  solo?: boolean;
}

interface CortexConceptLike {
  bucketId: string;
  canonical: string;
  strength: number;
  category: StrengthCategory;
  importance: number;
  conceptType: ConceptType;
  accessCount: number;
  daysSinceAccess: number;
  createdAt: string | number;
  documentId: string | null;
}

interface CortexRelationshipLike {
  relationshipId: string;
  sourceBucket: string;
  targetBucket: string;
  relationType: string;
  confidence: number;
}

interface CortexMapLike {
  core?: CortexCoreLike | null;
  documents?: CortexDocumentNodeLike[];
  concepts?: CortexConceptLike[];
  relationships?: CortexRelationshipLike[];
  conceptDegree?: Record<string, number>;
  bucketDocumentMap?: Record<string, string | null>;
}

interface HeroParticleConfig {
  left: string;
  bottom: string;
  dur: string;
  delay: string;
  drift: string;
  size: string;
  color: string;
  glow: string;
}

const EMPTY_DOCUMENTS: CortexDocumentNodeLike[] = [];
const EMPTY_CONCEPTS: CortexConceptLike[] = [];
const EMPTY_RELATIONSHIPS: CortexRelationshipLike[] = [];
const EMPTY_GRAPH_NODES: CortexGraphNode[] = [];
const EMPTY_DEGREE: Record<string, number> = {};
const EMPTY_BUCKET_DOCUMENT_MAP: Record<string, string | null> = {};

const HERO_PARTICLES: HeroParticleConfig[] = [
  { left: "22%", bottom: "32%", dur: "7.2s", delay: "0s", drift: "16px", size: "3px", color: "rgba(255,177,92,0.8)", glow: "rgba(255,138,61,0.45)" },
  { left: "38%", bottom: "26%", dur: "9.5s", delay: "1.3s", drift: "-20px", size: "2.5px", color: "rgba(196,239,235,0.7)", glow: "rgba(143,216,210,0.38)" },
  { left: "55%", bottom: "36%", dur: "6.8s", delay: "2.6s", drift: "22px", size: "3.4px", color: "rgba(255,225,168,0.72)", glow: "rgba(255,177,92,0.4)" },
  { left: "70%", bottom: "30%", dur: "8.4s", delay: "0.7s", drift: "-14px", size: "2px", color: "rgba(255,138,61,0.68)", glow: "rgba(255,138,61,0.35)" },
  { left: "44%", bottom: "44%", dur: "10.8s", delay: "3.5s", drift: "10px", size: "2.8px", color: "rgba(143,216,210,0.6)", glow: "rgba(143,216,210,0.32)" },
  { left: "30%", bottom: "40%", dur: "7.6s", delay: "1.9s", drift: "-18px", size: "3.2px", color: "rgba(255,177,92,0.72)", glow: "rgba(255,138,61,0.42)" },
  { left: "62%", bottom: "48%", dur: "11.4s", delay: "4.1s", drift: "14px", size: "2.2px", color: "rgba(196,239,235,0.55)", glow: "rgba(143,216,210,0.28)" },
  { left: "48%", bottom: "22%", dur: "8.8s", delay: "2.3s", drift: "-24px", size: "2.6px", color: "rgba(255,225,168,0.6)", glow: "rgba(255,177,92,0.35)" },
];

function toTimestamp(value: string | number): number {
  const parsed = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}
function formatDomainLabel(domain: string): string {
  return (
    domain
      .split(/[-_\s]+/)
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "General"
  );
}

function createCortexNode(input: {
  id: string;
  label: string;
  conceptType: ConceptType;
  importance: number;
  strength: number;
  category: StrengthCategory;
  accessCount: number;
  daysSinceAccess: number;
  createdAt: number;
  kind: CortexNodeKind;
  domain?: string | null;
  documentId?: string | null;
  conceptCount?: number;
  connectedConceptCount?: number;
  isolatedConceptCount?: number;
  relatedDocumentCount?: number;
  solo?: boolean;
  island?: boolean;
  expanded?: boolean;
  boxWidth?: number;
  boxHeight?: number;
}): CortexGraphNode {
  const base = createGraphNode({
    id: input.id,
    label: input.label,
    conceptType: input.conceptType,
    importance: input.importance,
    strength: input.strength,
    category: input.category,
    accessCount: input.accessCount,
    daysSinceAccess: input.daysSinceAccess,
    createdAt: input.createdAt,
  });
  return {
    ...base,
    kind: input.kind,
    domain: input.domain ?? null,
    documentId: input.documentId ?? null,
    conceptCount: input.conceptCount,
    connectedConceptCount: input.connectedConceptCount,
    isolatedConceptCount: input.isolatedConceptCount,
    relatedDocumentCount: input.relatedDocumentCount,
    solo: input.solo,
    island: input.island,
    expanded: input.expanded,
    boxWidth: input.boxWidth,
    boxHeight: input.boxHeight,
  };
}

function createCortexEdge(input: {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  confidence: number;
  edgeKind?: string;
  crossDocument?: boolean;
}): GraphEdge {
  const base = createGraphEdge({
    id: input.id,
    source: input.source,
    target: input.target,
    type: input.type,
    confidence: input.confidence,
  });
  return {
    ...base,
    edgeKind: input.edgeKind,
    crossDocument: input.crossDocument ?? false,
  } as GraphEdge;
}

export function CortexPage() {
  const bridge = useCortexBridge();
  const {
    highlightedIds,
    selectedId,
    focusedId,
    pulseIds,
    retrieving,
    viewMode,
    selectedDocumentId,
    coreExpanded,
    highlight,
    clearHighlight,
    select,
    focus,
    pulse,
    setIdMap,
    openDocument,
    closeDocument,
    expandCore,
    collapseCore,
    reset,
  } = bridge;

  const map = useCortexMap();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemorySummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeTypes, setActiveTypes] = useState<ConceptType[]>([]);
  const [linkFilter, setLinkFilter] = useState<CortexLinkFilter>("all");
  const [layout, setLayout] = useState<LayoutMode>(
    () => (localStorage.getItem(STORAGE_KEYS.cortexLayout) as LayoutMode) || "constellation"
  );
  const [fitSignal, setFitSignal] = useState(0);
  const [statusIdle, setStatusIdle] = useState(true);
  const statusTimerRef = useRef<number | null>(null);
  const debouncedSearch = useDebounce(searchQuery, 260);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.cortexLayout, layout);
  }, [layout]);

  const data = useMemo(() => (map.data ?? null) as CortexMapLike | null, [map.data]);
  const documents = useMemo(() => data?.documents ?? EMPTY_DOCUMENTS, [data]);
  const concepts = useMemo(() => data?.concepts ?? EMPTY_CONCEPTS, [data]);
  const relationships = useMemo(() => data?.relationships ?? EMPTY_RELATIONSHIPS, [data]);
  const conceptDegree = useMemo(() => data?.conceptDegree ?? EMPTY_DEGREE, [data]);
  const bucketDocumentMap = useMemo(
    () => data?.bucketDocumentMap ?? EMPTY_BUCKET_DOCUMENT_MAP,
    [data]
  );
  const documentDomainById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of documents) {
      m.set(d.documentId, String((d as any).domain ?? "general") || "general");
    }
    return m;
  }, [documents]);
  const core = data?.core ?? null;
  const isEmpty = !map.loading && !map.error && documents.length === 0 && concepts.length === 0;

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const root = document.documentElement;
    const apply = () => {
      const keyboard = Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop);
      root.style.setProperty("--kb", `${Math.round(keyboard)}px`);
    };
    apply();
    visualViewport.addEventListener("resize", apply);
    return () => {
      visualViewport.removeEventListener("resize", apply);
      root.style.removeProperty("--kb");
    };
  }, []);

  useEffect(() => {
    const onActivity = () => {
      setStatusIdle(false);
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = window.setTimeout(() => {
        setStatusIdle(true);
      }, 2500);
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "touchstart", "wheel", "keydown"];
    for (const eventName of events) window.addEventListener(eventName, onActivity, { passive: true });
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, onActivity);
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setFitSignal((current) => current + 1);
  }, [viewMode, selectedDocumentId, searchOpen, filtersOpen, coreExpanded]);

  useEffect(() => {
    const term = debouncedSearch.trim();
    if (!term) {
      setSearchResults([]);
      setSearching(false);
      clearHighlight();
      return;
    }
    let cancelled = false;
    setSearchResults([]);
    setSearching(true);
    api.memories
      .list({ search: term, limit: 12 })
      .then((response) => {
        if (cancelled) return;
        setSearchResults(response.memories);
        highlight(response.memories.map((memory) => memory.bucketId));
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, clearHighlight, highlight]);

  useEffect(() => {
    if (!searchOpen && !filtersOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
        setSearchResults([]);
        clearHighlight();
      }
      if (filtersOpen) setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, filtersOpen, clearHighlight]);

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  const canonicalToId = useMemo(() => {
    const idMap = new Map<string, string>();
    for (const concept of concepts) {
      idMap.set(concept.canonical, concept.bucketId);
      idMap.set(normalizeCanonical(concept.canonical), concept.bucketId);
    }
    return idMap;
  }, [concepts]);

  useEffect(() => {
    setIdMap(canonicalToId);
  }, [canonicalToId, setIdMap]);

  const activeDocument = useMemo(
    () => documents.find((document) => document.documentId === selectedDocumentId) ?? null,
    [documents, selectedDocumentId]
  );

  const inDocumentView = viewMode === "document" && activeDocument !== null;
  const inCoreExpanded = coreExpanded && !inDocumentView;
  const inDeepView = inDocumentView || inCoreExpanded;

  const coreNodes = useMemo<CortexGraphNode[]>(() => {
    const nodes: CortexGraphNode[] = [];

    // ---- one big orbit hub per domain ----
    const docsByDomain = new Map<string, CortexDocumentNodeLike[]>();
    for (const document of documents) {
      const domain = String((document as any).domain ?? "general") || "general";
      const list = docsByDomain.get(domain) ?? [];
      list.push(document);
      docsByDomain.set(domain, list);
    }
    const domainEntries = Array.from(docsByDomain.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    for (const [domain, docs] of domainEntries) {
      const totalMemories = docs.reduce((sum, d) => sum + (d.conceptCount ?? 0), 0);
      const strengthSum = docs.reduce(
        (sum, d) => sum + (d.averageStrength ?? 0) * (d.conceptCount ?? 0),
        0
      );
      const averageStrength = totalMemories > 0 ? strengthSum / totalMemories : 0;
      nodes.push(
        createCortexNode({
          id: `domain:${domain}`,
          label: formatDomainLabel(domain),
          conceptType: "entity",
          importance: 10,
          strength: averageStrength,
          category: strengthCategory(averageStrength),
          accessCount: totalMemories,
          daysSinceAccess: 0,
          createdAt: Date.now(),
          kind: "domain",
          domain,
        })
      );
    }

    // ---- document cards (unchanged) ----
    for (const document of documents) {
      const conceptCount = document.conceptCount ?? 0;
      const averageDocumentStrength = document.averageStrength ?? 0;
      const uploadedAt = toTimestamp(document.uploadedAt);
      const relatedDocumentCount = document.relatedDocuments?.length ?? 0;
      nodes.push(
        createCortexNode({
          id: `doc:${document.documentId}`,
          label: document.filename,
          conceptType: "entity",
          importance: Math.max(3, Math.min(10, Math.round(conceptCount / 6) + 3)),
          strength: averageDocumentStrength,
          category: strengthCategory(averageDocumentStrength),
          accessCount: conceptCount,
          daysSinceAccess: daysSince(new Date(uploadedAt)),
          createdAt: uploadedAt,
          kind: "document",
          domain: (document as any).domain ?? null,
          documentId: document.documentId,
          conceptCount,
          connectedConceptCount: document.connectedConceptCount ?? 0,
          isolatedConceptCount: document.isolatedConceptCount ?? 0,
          relatedDocumentCount,
          solo: document.solo ?? relatedDocumentCount === 0,
        })
      );
    }
    return nodes;
  }, [documents]);

  const coreEdges = useMemo<GraphEdge[]>(
    () =>
      documents.map((document) => {
        const domain = String((document as any).domain ?? "general") || "general";
        return createCortexEdge({
          id: `domain-doc-${document.documentId}`,
          source: `domain:${domain}`,
          target: `doc:${document.documentId}`,
          type: "part_of",
          confidence: 1,
          edgeKind: "core-document",
        });
      }),
    [documents]
  );

  const fallbackNodes = useMemo<CortexGraphNode[]>(() => {
    if (documents.length > 0) return EMPTY_GRAPH_NODES;
    return concepts.map((concept) =>
      createCortexNode({
        id: concept.bucketId,
        label: concept.canonical,
        conceptType: concept.conceptType,
        importance: concept.importance,
        strength: concept.strength,
        category: concept.category,
        accessCount: concept.accessCount,
        daysSinceAccess: concept.daysSinceAccess,
        createdAt: toTimestamp(concept.createdAt),
        kind: "concept",
        documentId: concept.documentId,
        island: (conceptDegree[concept.bucketId] ?? 0) === 0,
      })
    );
  }, [documents.length, concepts, conceptDegree]);

  const fallbackNodeIds = useMemo(() => new Set(fallbackNodes.map((node) => node.id)), [fallbackNodes]);

  const fallbackEdges = useMemo<GraphEdge[]>(() => {
    if (documents.length > 0) return [];
    return relationships
      .filter(
        (relationship) =>
          fallbackNodeIds.has(relationship.sourceBucket) &&
          fallbackNodeIds.has(relationship.targetBucket) &&
          relationship.sourceBucket !== relationship.targetBucket
      )
      .map((relationship) =>
        createCortexEdge({
          id: relationship.relationshipId,
          source: relationship.sourceBucket,
          target: relationship.targetBucket,
          type: normalizeRelationType(relationship.relationType),
          confidence: relationship.confidence,
          edgeKind: "concept-concept",
        })
      );
  }, [documents.length, relationships, fallbackNodeIds]);

  const documentConcepts = useMemo(() => {
    if (!activeDocument) return EMPTY_CONCEPTS;
    return concepts.filter((concept) => concept.documentId === activeDocument.documentId);
  }, [activeDocument, concepts]);

  const scopedConcepts = inDocumentView ? documentConcepts : concepts;

  const visibleConcepts = useMemo(
    () =>
      scopedConcepts.filter((concept) => {
        const typeVisible = activeTypes.length === 0 || activeTypes.includes(concept.conceptType);
        const degree = conceptDegree[concept.bucketId] ?? 0;
        const linkVisible =
          linkFilter === "all" ? true : linkFilter === "linked" ? degree > 0 : degree === 0;
        return typeVisible && linkVisible;
      }),
    [scopedConcepts, activeTypes, linkFilter, conceptDegree]
  );

  const conceptNodes = useMemo<CortexGraphNode[]>(
    () =>
      visibleConcepts.map((concept) =>
        createCortexNode({
          id: concept.bucketId,
          label: concept.canonical,
          conceptType: concept.conceptType,
          importance: concept.importance,
          strength: concept.strength,
          category: concept.category,
          accessCount: concept.accessCount,
          daysSinceAccess: concept.daysSinceAccess,
          createdAt: toTimestamp(concept.createdAt),
          kind: "concept",
          documentId: concept.documentId,
          island: (conceptDegree[concept.bucketId] ?? 0) === 0,
        })
      ),
    [visibleConcepts, conceptDegree]
  );

  const visibleConceptIds = useMemo(() => new Set(conceptNodes.map((node) => node.id)), [conceptNodes]);

  const conceptEdges = useMemo<GraphEdge[]>(() => {
    return relationships
      .filter((relationship) => {
        if (
          !visibleConceptIds.has(relationship.sourceBucket) ||
          !visibleConceptIds.has(relationship.targetBucket) ||
          relationship.sourceBucket === relationship.targetBucket
        ) {
          return false;
        }
        const sourceDocument = bucketDocumentMap[relationship.sourceBucket] ?? null;
        const targetDocument = bucketDocumentMap[relationship.targetBucket] ?? null;
        const isCrossDocument = Boolean(
          sourceDocument && targetDocument && sourceDocument !== targetDocument
        );
        if (isCrossDocument) {
          const sourceDomain = sourceDocument
            ? documentDomainById.get(sourceDocument) ?? "general"
            : "general";
          const targetDomain = targetDocument
            ? documentDomainById.get(targetDocument) ?? "general"
            : "general";
          // hide cross-domain noise; keep only very strong cross-domain links
          if (sourceDomain !== targetDomain && relationship.confidence < 0.85) {
            return false;
          }
        }
        return true;
      })
      .map((relationship) => {
        const sourceDocument = bucketDocumentMap[relationship.sourceBucket] ?? null;
        const targetDocument = bucketDocumentMap[relationship.targetBucket] ?? null;
        return createCortexEdge({
          id: relationship.relationshipId,
          source: relationship.sourceBucket,
          target: relationship.targetBucket,
          type: normalizeRelationType(relationship.relationType),
          confidence: relationship.confidence,
          edgeKind: "concept-concept",
          crossDocument: Boolean(
            sourceDocument && targetDocument && sourceDocument !== targetDocument
          ),
        });
      });
  }, [relationships, visibleConceptIds, bucketDocumentMap, documentDomainById]);

  const currentNodes = inDocumentView
    ? conceptNodes
    : inCoreExpanded
      ? [...coreNodes, ...conceptNodes]
      : documents.length > 0
        ? coreNodes
        : fallbackNodes;
  const currentEdges = inDocumentView
    ? conceptEdges
    : inCoreExpanded
      ? [...coreEdges, ...conceptEdges]
      : documents.length > 0
        ? coreEdges
        : fallbackEdges;

  const sceneMode: CortexSceneMode = inDocumentView
    ? "document"
    : inCoreExpanded
      ? "core"
      : documents.length > 0
        ? "core"
        : "graph";

  const inspectorOpen = selectedId !== null;
  const sheetOpen = searchOpen || filtersOpen || inspectorOpen;

  const conceptTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const concept of scopedConcepts) {
      counts[concept.conceptType] = (counts[concept.conceptType] ?? 0) + 1;
    }
    return counts;
  }, [scopedConcepts]);

  const activeFilterCount =
    activeTypes.length +
    (linkFilter !== "all" ? 1 : 0) +
    (layout !== "constellation" ? 1 : 0);

  const showFilterButton = !isEmpty || concepts.length > 0;

  const toggleType = (type: ConceptType) => {
    setActiveTypes((current) =>
      current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]
    );
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    clearHighlight();
  };

  const openSearch = () => {
    setFiltersOpen(false);
    select(null);
    focus(null);
    setSearchOpen(true);
  };

  const commitSearch = (bucketId: string) => {
    const documentId = bucketDocumentMap[bucketId] ?? null;
    if (documentId) openDocument(documentId);
    select(bucketId);
    highlight([bucketId]);
    pulse([bucketId]);
    focus(bucketId);
    setSearchOpen(false);
    setFiltersOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setFitSignal((current) => current + 1);
  };

  const handleCoreClick = () => {
    clearHighlight();
    select(null);
    focus(null);
    expandCore();
  };

  const handleDocumentClick = (node: GraphNode) => {
    const cortexNode = node as CortexGraphNode;
    const documentId = cortexNode.documentId ?? (node.id.startsWith("doc:") ? node.id.slice(4) : null);
    if (documentId) openDocument(documentId);
  };

  const handleConceptClick = (node: GraphNode) => {
    console.log("TAPPED:", node.id, node.label);
    clearHighlight();
    select(node.id);
  };

  const handleBackgroundClick = () => {
    clearHighlight();
    select(null);
    focus(null);
  };

  const handleBack = () => {
    if (inDocumentView) {
      closeDocument();
      return;
    }
    if (inCoreExpanded) {
      collapseCore();
    }
  };

  const statusLabel = inCoreExpanded
    ? `${concepts.length} memories in view · ${relationships.length} links`
    : activeDocument
      ? `${activeDocument.conceptCount ?? 0} memories · ${activeDocument.connectedConceptCount ?? 0} linked · ${activeDocument.isolatedConceptCount ?? 0} islands`
      : `${core?.documentCount ?? 0} files · ${core?.totalMemories ?? 0} memories · avg ${Math.round((core?.averageStrength ?? 0) * 100)}%`;

  return (
    <div className="cortex-root relative h-full overflow-hidden">
      <CortexCanvas
        nodes={currentNodes as GraphNode[]}
        edges={currentEdges}
        layout={layout}
        sceneMode={sceneMode}
        highlightedIds={highlightedIds}
        selectedId={selectedId}
        focusedId={focusedId}
        pulseIds={pulseIds}
        retrieving={retrieving}
        panelsHidden={true}
        fitSignal={fitSignal}
        drawerOpen={inspectorOpen}
        sheetOpen={sheetOpen}
        onCoreClick={handleCoreClick}
        onDocumentClick={handleDocumentClick}
        onDocumentOpen={handleDocumentClick}
        onConceptClick={handleConceptClick}
        onBackgroundClick={handleBackgroundClick}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-[66] flex items-center justify-between gap-2 md:inset-x-5 md:top-4">
        {inDeepView ? (
          <button
            className="pointer-events-auto grid h-10 w-10 place-items-center rounded-xl border border-line-strong bg-coal/70 text-bone shadow-lift backdrop-blur-xl transition-all hover:border-ember/40 hover:text-ember-hi"
            onClick={handleBack}
            aria-label="Back to core"
          >
            <span className="text-[15px]">←</span>
          </button>
        ) : (
          <span />
        )}
        <div className="pointer-events-auto flex items-center gap-2">
          {showFilterButton && (
            <button
              className="relative grid h-10 w-10 place-items-center rounded-xl border border-line-strong bg-coal/70 text-stone shadow-lift backdrop-blur-xl transition-all hover:border-ember/40 hover:text-bone"
              onClick={() => setFiltersOpen(true)}
              aria-label="Open filters"
            >
              <Icon name="settings" size={17} />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ember px-1 font-mono text-[8px] font-semibold text-[#2A1708]">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
          <button
            className="grid h-10 w-10 place-items-center rounded-xl border border-line-strong bg-coal/70 text-stone shadow-lift backdrop-blur-xl transition-all hover:border-ember/40 hover:text-bone"
            onClick={openSearch}
            aria-label="Search memories"
          >
            <Icon name="search" size={17} />
          </button>
        </div>
      </div>

      {!isEmpty && (
        <div
          className={`pointer-events-none absolute bottom-[calc(18px_+_env(safe-area-inset-bottom))] left-1/2 z-hud hidden -translate-x-1/2 transition-all duration-500 md:block ${statusIdle ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
        >
          <div className="max-w-[760px] truncate rounded-full border border-line-strong bg-coal/80 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-stone shadow-lift backdrop-blur-xl">
            {statusLabel}
          </div>
        </div>
      )}

      {map.loading && !map.data && (
        <div className="absolute inset-0 z-drawer flex flex-col items-center justify-center gap-6 bg-void/70 backdrop-blur-sm">
          <NeuralSpinner size={56} />
          <p className="t-mono text-[10px] uppercase tracking-[0.32em] text-stone">Mapping your memory universe</p>
        </div>
      )}

      {map.error && (
        <div className="absolute inset-0 z-drawer flex items-center justify-center px-6">
          <div className="max-w-md rounded-3xl border border-flare/30 bg-flare/10 p-6 text-center">
            <p className="font-display text-xl text-bone">Cortex failed to load</p>
            <p className="mt-2 text-sm text-stone">{map.error}</p>
            <button className="btn btn-primary mt-5" onClick={() => void map.refetch()}>Retry</button>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="absolute inset-0 z-drawer flex items-center justify-center overflow-hidden px-6 pb-[calc(88px_+_env(safe-area-inset-bottom))] lg:pb-0">
          <div className="cortex-hero-orb" />
          {HERO_PARTICLES.map((p, i) => (
            <div
              key={i}
              className="hero-particle"
              style={{ left: p.left, bottom: p.bottom, "--pd": p.dur, "--pdl": p.delay, "--px": p.drift, "--py": "-170px", "--ps": p.size, "--pc": p.color, "--pc-glow": p.glow } as React.CSSProperties}
            />
          ))}
          <div className="relative z-10 max-w-lg text-center">
            <p className="kicker justify-center fx-rise" style={{ "--rise-delay": "0.15s" } as React.CSSProperties}>Tabula rasa</p>
            <h2 className="fx-rise font-display text-[clamp(28px,8.5vw,52px)] font-medium tracking-[-0.015em] text-bone" style={{ "--rise-delay": "0.38s" } as React.CSSProperties}>
              Your mind is <em className="cortex-hero-em">empty.</em>
            </h2>
            <p className="mx-auto mt-5 max-w-sm text-[15px] font-light leading-relaxed text-stone fx-rise" style={{ "--rise-delay": "0.58s" } as React.CSSProperties}>
              Upload a document and it becomes a living memory node. Every file connects to your core, and every concept inside it can grow relationships.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3 fx-rise" style={{ "--rise-delay": "0.78s" } as React.CSSProperties}>
              <Link to={ROUTES.archive} className="btn btn-primary cortex-cta-shimmer">Feed it a document</Link>
              <Link to={ROUTES.dive} className="btn btn-ghost">Start a conversation</Link>
            </div>
          </div>
        </div>
      )}

      <CortexSearch
        open={searchOpen}
        query={searchQuery}
        searching={searching}
        memories={searchResults}
        documents={documents}
        onQueryChange={setSearchQuery}
        onClose={closeSearch}
        onSelectMemory={commitSearch}
        onSelectDocument={(documentId) => {
          openDocument(documentId);
          closeSearch();
        }}
      />

      <GraphFilters
        variant="overlay"
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        layout={layout}
        onLayoutChange={setLayout}
        activeTypes={activeTypes}
        onToggleType={toggleType}
        onShowAll={() => setActiveTypes([])}
        counts={conceptTypeCounts}
        linkFilter={linkFilter}
        onLinkFilterChange={setLinkFilter}
        showLayoutSwitcher={true}
        visibleCount={visibleConcepts.length}
        totalCount={scopedConcepts.length}
      />

      <MemoryInspector bucketId={selectedId} onClose={() => select(null)} onReignited={(bucketId) => pulse([bucketId])} />
    </div>
  );
}
