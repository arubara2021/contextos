import type {
  ConceptType,
  CortexDocumentState,
  RelationshipType,
  StrengthCategory,
} from "../types";

export type CortexNodeKind = "core" | "document" | "concept";

export interface GraphNode {
  id: string;
  label: string;
  conceptType: ConceptType;
  importance: number;
  strength: number;
  category: StrengthCategory;
  accessCount: number;
  daysSinceAccess: number;
  createdAt: number;
  x: number;
  y: number;
  fx: number | null;
  fy: number | null;
  radius: number;
  held: boolean;
  kind?: CortexNodeKind;
  domain?: string | null;
  documentId?: string | null;
  documentState?: CortexDocumentState;
  fileType?: string;
  uploadedAt?: string;
  conceptCount?: number;
  connectedConceptCount?: number;
  isolatedConceptCount?: number;
  relatedDocumentCount?: number;
  solo?: boolean;
  island?: boolean;
  expanded?: boolean;
  boxWidth?: number;
  boxHeight?: number;
  clusterId?: string;
  clusterAnchor?: boolean;
  clusterCenterX?: number;
  clusterCenterY?: number;
  clusterRadius?: number;
  ring?: number;
  wedgeAngle?: number;
  wedgeLabel?: string;
  orbitAngle?: number;
  orbitRadius?: number;
  orbitSpeed?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  confidence: number;
  edgeKind?:
  | "core-document"
  | "document-concept"
  | "concept-concept"
  | "document-bridge";
  crossDocument?: boolean;
  sourceDocumentId?: string | null;
  targetDocumentId?: string | null;
}

export interface Scene {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  coreNode?: GraphNode | null;
  documentNodes?: GraphNode[];
  conceptNodes?: GraphNode[];
}

export type LayoutMode = "constellation" | "orbit" | "timeline";

export type CortexLayoutMode = LayoutMode | "core" | "document";

export interface Signal {
  id: string;
  edgeId: string;
  progress: number;
  speed: number;
  color: string;
  reverse: boolean;
}

export interface HoverState {
  nodeId: string | null;
  x: number;
  y: number;
}

export interface RenderOptions {
  layout: LayoutMode;
  reducedMotion: boolean;
  highlightedIds: Set<string>;
  selectedId: string | null;
  focusedId: string | null;
  retrieving: boolean;
  pulseIds: Set<string>;
  hover: HoverState | null;
  showLabels: boolean;
  time: number;
  dpr: number;
}

export function createGraphNode(input: {
  id: string;
  label: string;
  conceptType: ConceptType;
  importance: number;
  strength: number;
  category: StrengthCategory;
  accessCount: number;
  daysSinceAccess: number;
  createdAt: number;
  x?: number;
  y?: number;
  kind?: CortexNodeKind;
  domain?: string | null;
  documentId?: string | null;
  documentState?: CortexDocumentState;
  fileType?: string;
  uploadedAt?: string;
  conceptCount?: number;
  connectedConceptCount?: number;
  isolatedConceptCount?: number;
  relatedDocumentCount?: number;
  solo?: boolean;
  island?: boolean;
  expanded?: boolean;
  boxWidth?: number;
  boxHeight?: number;
}): GraphNode {
  return {
    id: input.id,
    label: input.label,
    conceptType: input.conceptType,
    importance: input.importance,
    strength: input.strength,
    category: input.category,
    accessCount: input.accessCount,
    daysSinceAccess: input.daysSinceAccess,
    createdAt: input.createdAt,
    x: input.x ?? 0,
    y: input.y ?? 0,
    fx: null,
    fy: null,
    radius: 14 + input.importance * 2.5,
    held: false,
    kind: input.kind ?? "concept",
    domain: input.domain ?? null,
    documentId: input.documentId ?? null,
    documentState: input.documentState,
    fileType: input.fileType,
    uploadedAt: input.uploadedAt,
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

export function createGraphEdge(input: {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  confidence: number;
  edgeKind?:
  | "core-document"
  | "document-concept"
  | "concept-concept"
  | "document-bridge";
  crossDocument?: boolean;
  sourceDocumentId?: string | null;
  targetDocumentId?: string | null;
}): GraphEdge {
  return {
    id: input.id,
    source: input.source,
    target: input.target,
    type: input.type,
    confidence: input.confidence,
    edgeKind: input.edgeKind,
    crossDocument: input.crossDocument ?? false,
    sourceDocumentId: input.sourceDocumentId ?? null,
    targetDocumentId: input.targetDocumentId ?? null,
  };
}

export function buildScene(nodes: GraphNode[], edges: GraphEdge[]): Scene {
  return {
    nodes,
    edges,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coreNode: nodes.find((node) => (node.kind ?? "concept") === "core") ?? null,
    documentNodes: nodes.filter((node) => (node.kind ?? "concept") === "document"),
    conceptNodes: nodes.filter((node) => (node.kind ?? "concept") === "concept"),
  };
}