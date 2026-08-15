import { CONCEPT_TYPE_ORDER, strengthCategory } from "../constants";
import { nodeRadius } from "../utils/color";
import type { CortexLayoutMode, GraphEdge, GraphNode } from "./types";

const TAU = Math.PI * 2;
const GOLDEN = 2.399963229728653;
const RING_LABELS = ["CORE", "FADING", "RIM"];
const SLOT_GAP = 38;
const CONCEPT_SLOT_GAP = 40;

const DESKTOP_DOC_WIDTH = 200;
const DESKTOP_DOC_HEIGHT = 80;
const MOBILE_DOC_WIDTH = 160;
const MOBILE_DOC_HEIGHT = 64;
const DEFAULT_CORE_RADIUS = 32;

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function defaultDocWidth(): number {
  return isMobileViewport() ? MOBILE_DOC_WIDTH : DESKTOP_DOC_WIDTH;
}

function defaultDocHeight(): number {
  return isMobileViewport() ? MOBILE_DOC_HEIGHT : DESKTOP_DOC_HEIGHT;
}

function pin(node: GraphNode, x: number, y: number): void {
  node.x = x;
  node.y = y;
  node.fx = x;
  node.fy = y;
}

function clearLayoutVisuals(node: GraphNode): void {
  node.clusterId = undefined;
  node.clusterAnchor = undefined;
  node.clusterCenterX = undefined;
  node.clusterCenterY = undefined;
  node.clusterRadius = undefined;
  node.ring = undefined;
  node.wedgeAngle = undefined;
  node.wedgeLabel = undefined;
  node.orbitAngle = undefined;
  node.orbitRadius = undefined;
  node.orbitSpeed = undefined;
}

function resetFields(node: GraphNode): void {
  node.held = false;
  clearLayoutVisuals(node);
}

function ringOf(node: GraphNode): number {
  const cat = strengthCategory(node.strength);
  if (cat === "strong") return 0;
  if (cat === "fading") return 1;
  return 2;
}

function presentTypes(nodes: GraphNode[]): string[] {
  const set = new Set(nodes.map((n) => n.conceptType));
  return CONCEPT_TYPE_ORDER.filter((t) => set.has(t));
}

function docWidth(node: GraphNode): number {
  return node.boxWidth ?? defaultDocWidth();
}

function docHeight(node: GraphNode): number {
  return node.boxHeight ?? defaultDocHeight();
}

function docRadius(node: GraphNode): number {
  return Math.max(46, Math.hypot(docWidth(node), docHeight(node)) / 2.35);
}

function initializeNode(node: GraphNode): void {
  if ((node.kind ?? "concept") === "core") {
    node.radius = DEFAULT_CORE_RADIUS;
    node.boxWidth = DEFAULT_CORE_RADIUS * 2;
    node.boxHeight = DEFAULT_CORE_RADIUS * 2;
    return;
  }
  if ((node.kind ?? "concept") === "document") {
    node.boxWidth = defaultDocWidth();
    node.boxHeight = defaultDocHeight();
    node.radius = docRadius(node);
    return;
  }
  if ((node.kind ?? "concept") === "domain") {
    const count = node.conceptCount ?? 0;
    node.radius = Math.max(40, Math.min(72, 34 + count * 0.35));
    node.boxWidth = node.radius * 2;
    node.boxHeight = node.radius * 2;
    return;
  }
  node.radius = nodeRadius(node.importance);
}

function packCluster(
  cx: number,
  cy: number,
  members: GraphNode[],
  clusterId: string
): void {
  if (members.length === 0) return;
  const avgR = members.reduce((sum, n) => sum + n.radius, 0) / members.length;
  const slot = 2 * avgR + SLOT_GAP;
  const anchor = members[0];
  pin(anchor, cx, cy);
  anchor.clusterAnchor = true;
  anchor.clusterId = clusterId;
  anchor.clusterCenterX = cx;
  anchor.clusterCenterY = cy;
  let ringRadius = anchor.radius + avgR + SLOT_GAP;
  let ringIndex = 0;
  const rest = members.slice(1);
  while (rest.length > 0) {
    const circumference = TAU * ringRadius;
    const capacity = Math.max(1, Math.floor(circumference / slot));
    const take = rest.splice(0, capacity);
    const offset = ringIndex * GOLDEN;
    for (let k = 0; k < take.length; k++) {
      const ang = offset + ((k + 0.5) / take.length) * TAU;
      const node = take[k];
      pin(node, cx + Math.cos(ang) * ringRadius, cy + Math.sin(ang) * ringRadius);
      node.clusterAnchor = false;
      node.clusterId = clusterId;
      node.clusterCenterX = cx;
      node.clusterCenterY = cy;
    }
    ringRadius += slot;
    ringIndex++;
  }
  const halo = ringRadius;
  for (const node of members) node.clusterRadius = halo;
}

function packAroundCenter(
  cx: number,
  cy: number,
  centerRadius: number,
  members: GraphNode[],
  clusterId: string
): void {
  if (members.length === 0) return;
  const sorted = members.slice().sort((a, b) => b.importance - a.importance);
  const avgR = sorted.reduce((sum, n) => sum + n.radius, 0) / sorted.length;
  const slot = 2 * avgR + CONCEPT_SLOT_GAP;
  let ringRadius = centerRadius + avgR + CONCEPT_SLOT_GAP;
  let ringIndex = 0;
  let rest = sorted.slice();
  while (rest.length > 0) {
    const circumference = TAU * ringRadius;
    const capacity = Math.max(1, Math.floor(circumference / slot));
    const take = rest.splice(0, capacity);
    const offset = ringIndex * GOLDEN;
    for (let k = 0; k < take.length; k++) {
      const ang = offset + ((k + 0.5) / take.length) * TAU;
      const node = take[k];
      pin(node, cx + Math.cos(ang) * ringRadius, cy + Math.sin(ang) * ringRadius);
      node.clusterAnchor = false;
      node.clusterId = clusterId;
      node.clusterCenterX = cx;
      node.clusterCenterY = cy;
    }
    ringRadius += slot;
    ringIndex++;
  }
}

function packIslandGrid(cx: number, cy: number, members: GraphNode[]): void {
  if (members.length === 0) return;
  const sorted = members.slice().sort((a, b) => b.importance - a.importance);
  const columns = Math.max(2, Math.ceil(Math.sqrt(sorted.length)));
  const rows = Math.ceil(sorted.length / columns);
  const cell = Math.max(...sorted.map((node) => node.radius * 2)) + 64;
  sorted.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    pin(
      node,
      cx + (col - (columns - 1) / 2) * cell,
      cy + (row - (rows - 1) / 2) * cell
    );
    node.clusterId = "islands";
    node.clusterCenterX = cx;
    node.clusterCenterY = cy;
  });
}

function relaxLinks(nodes: GraphNode[], edges: GraphEdge[]): void {
  if (edges.length === 0) return;
  const byId = new Map<string, GraphNode>();
  const concepts: GraphNode[] = [];
  for (const node of nodes) {
    byId.set(node.id, node);
    if ((node.kind ?? "concept") === "concept") concepts.push(node);
  }
  if (concepts.length === 0) return;

  for (let pass = 0; pass < 3; pass++) {
    for (const edge of edges) {
      const a = byId.get(edge.source);
      const b = byId.get(edge.target);
      if (!a || !b || a === b) continue;
      if ((a.kind ?? "concept") !== "concept" || (b.kind ?? "concept") !== "concept") continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      const ideal = a.radius + b.radius + SLOT_GAP * 2.4;
      if (dist <= ideal) continue;
      const pull = (dist - ideal) * 0.16;
      const ux = dx / dist;
      const uy = dy / dist;
      a.x += ux * pull;
      a.y += uy * pull;
      b.x -= ux * pull;
      b.y -= uy * pull;
    }
    for (let i = 0; i < concepts.length; i++) {
      const a = concepts[i];
      for (let j = i + 1; j < concepts.length; j++) {
        const b = concepts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 0.001);
        const minDist = a.radius + b.radius + 16;
        if (dist >= minDist) continue;
        const push = (minDist - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
  }

  for (const node of concepts) {
    if (!node.held) {
      node.fx = node.x;
      node.fy = node.y;
    }
  }
}

function constellation(nodes: GraphNode[], edges: GraphEdge[] = []): void {
  const types = presentTypes(nodes);
  const clusterCount = Math.max(1, types.length);
  const clusterRing = 320 + clusterCount * 40;
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.conceptType) ?? [];
    list.push(node);
    groups.set(node.conceptType, list);
  }
  types.forEach((type, i) => {
    const members = (groups.get(type) ?? [])
      .slice()
      .sort((a, b) => b.importance - a.importance);
    const angle = -Math.PI / 2 + (i / clusterCount) * TAU;
    const cx = Math.cos(angle) * clusterRing;
    const cy = Math.sin(angle) * clusterRing;
    packCluster(cx, cy, members, type);
  });
  relaxLinks(nodes, edges);
}

function orbit(nodes: GraphNode[]): void {
  const types = presentTypes(nodes);
  const typeCount = Math.max(1, types.length);
  const arcPerType = TAU / typeCount;
  const usable = arcPerType * 0.78;
  const base = 96 + nodes.length * 1.7;
  const step = 70 + nodes.length * 0.6;
  const ringRadiusFor = (r: number) => base + r * step;
  const typeIndex = new Map(types.map((t, i) => [t, i]));
  const buckets = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = `${node.conceptType}:${ringOf(node)}`;
    const list = buckets.get(key) ?? [];
    list.push(node);
    buckets.set(key, list);
  }
  for (const [key, members] of buckets) {
    const sep = key.lastIndexOf(":");
    const type = key.substring(0, sep);
    const ring = Number(key.substring(sep + 1));
    const ac = -Math.PI / 2 + (typeIndex.get(type) ?? 0) * arcPerType;
    const sorted = members.slice().sort((a, b) => b.importance - a.importance);
    const avgR = sorted.reduce((sum, n) => sum + n.radius, 0) / sorted.length;
    const slot = 2 * avgR + SLOT_GAP;
    let subRing = 0;
    let radius = ringRadiusFor(ring);
    while (sorted.length > 0) {
      const arcLen = usable * radius;
      const capacity = Math.max(1, Math.floor(arcLen / slot));
      const take = sorted.splice(0, capacity);
      for (let k = 0; k < take.length; k++) {
        const frac = (k + 0.5) / take.length;
        const ang = ac - usable / 2 + usable * frac;
        const node = take[k];
        pin(node, Math.cos(ang) * radius, Math.sin(ang) * radius);
        node.ring = ring;
        node.wedgeAngle = ac;
        node.wedgeLabel = type;
        node.orbitRadius = radius;
        node.orbitAngle = ang;
        node.orbitSpeed = 0.045 / (ring + 1 + subRing * 0.6);
      }
      subRing++;
      radius += slot;
    }
  }
}

function timeline(nodes: GraphNode[]): void {
  const labelPx = 150;
  const maxDiam = nodes.reduce((m, n) => Math.max(m, 2 * n.radius), 0);
  const pitchX = Math.max(maxDiam, labelPx) + 30;
  const pitchY = Math.max(maxDiam, 64) + 40;
  const count = nodes.length;
  const cols = Math.max(1, Math.round(Math.sqrt(count * (pitchX / pitchY))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const ordered = nodes.slice().sort((a, b) => a.createdAt - b.createdAt);
  ordered.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    pin(
      node,
      (col - (cols - 1) / 2) * pitchX,
      (row - (rows - 1) / 2) * pitchY
    );
  });
}

function coreLayout(nodes: GraphNode[]): void {
  const coreNode = nodes.find((node) => (node.kind ?? "concept") === "core");
  const documents = nodes.filter((node) => (node.kind ?? "concept") === "document");
  const concepts = nodes.filter((node) => (node.kind ?? "concept") === "concept");

  if (coreNode) {
    pin(coreNode, 0, 0);
    coreNode.clusterId = "core";
    coreNode.clusterCenterX = 0;
    coreNode.clusterCenterY = 0;
  }

  const docById = new Map<string, GraphNode>();
  for (const d of documents) docById.set(d.id, d);

  // Documents grouped into sectors by domain (topic)
  const groups = new Map<string, GraphNode[]>();
  for (const doc of documents) {
    const domain = String((doc as any).domain ?? "general");
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(doc);
  }
  const domainList = Array.from(groups.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const domainCount = Math.max(1, domainList.length);

  domainList.forEach(([domain, docs], di) => {
    const sector = -Math.PI / 2 + (di / domainCount) * TAU;
    const sorted = docs
      .slice()
      .sort((a, b) => (b.conceptCount ?? 0) - (a.conceptCount ?? 0));
    sorted.forEach((doc, i) => {
      const spread = sorted.length > 1 ? i / (sorted.length - 1) - 0.5 : 0;
      const angle = sector + spread * 0.7;
      const radius = 320 + (i % 2) * 190;
      pin(doc, Math.cos(angle) * radius, Math.sin(angle) * radius);
      doc.clusterId = `domain:${domain}`;
      doc.clusterCenterX = Math.cos(sector) * 320;
      doc.clusterCenterY = Math.sin(sector) * 320;
    });
  });

  // Concepts form ISOLATED islands around their own document
  const byDoc = new Map<string, GraphNode[]>();
  const orphan: GraphNode[] = [];
  for (const c of concepts) {
    const did = String((c as any).documentId ?? "");
    const key = did ? `doc:${did}` : "";
    if (key && docById.has(key)) {
      if (!byDoc.has(key)) byDoc.set(key, []);
      byDoc.get(key)!.push(c);
    } else {
      orphan.push(c);
    }
  }
  for (const [docKey, members] of byDoc) {
    const doc = docById.get(docKey);
    if (!doc) continue;
    packAroundCenter(doc.x, doc.y, doc.radius + 34, members, `island:${docKey}`);
  }
  if (orphan.length > 0) {
    packCluster(0, 680, orphan, "core-concepts");
  }
}

function domainLayout(nodes: GraphNode[]): void {
  const hubs = nodes.filter((node) => (node.kind ?? "concept") === "domain");
  const concepts = nodes.filter((node) => (node.kind ?? "concept") === "concept");
  if (hubs.length === 0) {
    constellation(concepts);
    return;
  }
  const expandedHub = hubs.find((hub) => hub.expanded) ?? null;
  const sortedHubs = hubs
    .slice()
    .sort((a, b) => String(a.domain ?? "").localeCompare(String(b.domain ?? "")));
  const hubCount = sortedHubs.length;
  const hubRing = hubCount === 1 ? 0 : 520 + hubCount * 90;
  sortedHubs.forEach((hub, i) => {
    const cluster = `domain:${String(hub.domain ?? "general")}`;
    if (expandedHub && hub === expandedHub) {
      pin(hub, 0, 0);
    } else if (expandedHub) {
      const angle = -Math.PI / 2 + (i / Math.max(1, hubCount)) * TAU;
      const radius = Math.max(900, 700 + concepts.length * 6);
      pin(hub, Math.cos(angle) * radius, Math.sin(angle) * radius);
    } else {
      const angle =
        hubCount === 1 ? -Math.PI / 2 : -Math.PI / 2 + (i / hubCount) * TAU;
      pin(hub, Math.cos(angle) * hubRing, Math.sin(angle) * hubRing);
    }
    hub.clusterId = cluster;
    hub.clusterCenterX = hub.x;
    hub.clusterCenterY = hub.y;
  });
  if (expandedHub) {
    const domainKey = String(expandedHub.domain ?? "general");
    const members = concepts.filter(
      (node) => String(node.domain ?? "general") === domainKey
    );
    packAroundCenter(0, 0, expandedHub.radius + 46, members, `domain:${domainKey}`);
    return;
  }
  const byDomain = new Map<string, GraphNode[]>();
  for (const node of concepts) {
    const key = String(node.domain ?? "general");
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key)!.push(node);
  }
  for (const hub of sortedHubs) {
    const members = byDomain.get(String(hub.domain ?? "general")) ?? [];
    if (members.length > 0) {
      packAroundCenter(hub.x, hub.y, hub.radius + 40, members, `domain:${String(hub.domain ?? "general")}`);
    }
  }
}
function documentLayout(nodes: GraphNode[]): void {
  const active =
    nodes.find(
      (node) => (node.kind ?? "concept") === "document" && node.expanded
    ) ?? nodes.find((node) => (node.kind ?? "concept") === "document");
  const concepts = nodes.filter((node) => (node.kind ?? "concept") === "concept");
  const otherDocuments = nodes.filter(
    (node) => (node.kind ?? "concept") === "document" && node !== active
  );
  if (active) {
    pin(active, 0, 0);
    active.expanded = true;
    active.clusterId = "document-root";
    active.clusterCenterX = 0;
    active.clusterCenterY = 0;
  }
  const linked = concepts.filter((node) => !node.island);
  const islands = concepts.filter((node) => node.island);
  const centerX = active?.x ?? 0;
  const centerY = active?.y ?? 0;
  const centerRadius = active ? active.radius + 38 : 130;
  if (linked.length > 0) {
    packAroundCenter(
      centerX,
      centerY,
      centerRadius,
      linked,
      active?.id ?? "document-concepts"
    );
  }
  if (islands.length > 0) {
    packIslandGrid(
      centerX + (active ? docWidth(active) : 220) + 380,
      centerY,
      islands
    );
  }
  if (otherDocuments.length > 0) {
    const radius = Math.max(
      640,
      centerRadius + linked.length * 26 + islands.length * 20
    );
    otherDocuments.forEach((node, index) => {
      const angle =
        -Math.PI / 2 + (index / Math.max(1, otherDocuments.length)) * TAU;
      pin(node, Math.cos(angle) * radius, Math.sin(angle) * radius);
      node.clusterId = "document-bridges";
      node.clusterCenterX = centerX;
      node.clusterCenterY = centerY;
    });
  }
  if (!active && concepts.length > 0) {
    constellation(concepts);
  }
}

export function applyLayout(
  nodes: GraphNode[],
  mode: CortexLayoutMode,
  edges: GraphEdge[] = []
): void {
  if (nodes.length === 0) return;
  const placed: GraphNode[] = [];
  for (const node of nodes) {
    initializeNode(node);
    if (node.held) {
      clearLayoutVisuals(node);
    } else {
      resetFields(node);
      placed.push(node);
    }
  }
  if (placed.length === 0) return;
  if (mode === "core") {
    coreLayout(placed);
    return;
  }
  if (mode === "document") {
    documentLayout(placed);
    return;
  }
  if (mode === "domain") {
    domainLayout(placed);
    return;
  }
  if (mode === "orbit") {
    orbit(placed);
    return;
  }
  if (mode === "timeline") {
    timeline(placed);
    return;
  }
  constellation(placed, edges);
}

export { RING_LABELS };
export function applySmartLayout(
  nodes: GraphNode[],
  width: number,
  height: number
): void {
  if (nodes.length === 0) return;

  const conceptNodes = nodes.filter((n) => (n.kind ?? "concept") === "concept");
  const docNodes = nodes.filter((n) => (n.kind ?? "concept") === "document");
  const coreNodes = nodes.filter((n) => (n.kind ?? "concept") === "core");

  if (conceptNodes.length === 0 && docNodes.length === 0) return;

  const maxDim = Math.max(width, height);
  const baseSpacing = Math.max(80, maxDim / Math.max(8, Math.sqrt(nodes.length) * 1.2));

  const byType = new Map<string, GraphNode[]>();
  for (const node of conceptNodes) {
    const type = node.conceptType ?? "unknown";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(node);
  }

  for (const [, group] of byType) {
    group.sort((a, b) => b.importance - a.importance);
  }

  const sortedTypes = [...byType.entries()].sort((a, b) => {
    const aMax = a[1][0]?.importance ?? 0;
    const bMax = b[1][0]?.importance ?? 0;
    return bMax - aMax;
  });

  const totalNodes = conceptNodes.length + docNodes.length;
  const layoutRadius = baseSpacing * Math.max(2, Math.sqrt(totalNodes) * 0.7);

  for (const core of coreNodes) {
    core.x = 0;
    core.y = 0;
    core.fx = 0;
    core.fy = 0;
  }

  if (docNodes.length > 0) {
    const docRingRadius = layoutRadius * 0.4;
    docNodes.forEach((node, i) => {
      const angle = (i / docNodes.length) * Math.PI * 2 - Math.PI / 2;
      node.x = Math.cos(angle) * docRingRadius;
      node.y = Math.sin(angle) * docRingRadius;
      node.fx = node.x;
      node.fy = node.y;
    });
  }

  const typeAngleMap = new Map<string, { startAngle: number; endAngle: number }>();
  const totalWeight = sortedTypes.reduce((sum, [, group]) => sum + group.length, 0);
  let currentAngle = -Math.PI / 2;
  const gapAngle = 0.15;

  for (const [type, group] of sortedTypes) {
    const share = group.length / totalWeight;
    const sweep = share * Math.PI * 2 - gapAngle;
    typeAngleMap.set(type, {
      startAngle: currentAngle,
      endAngle: currentAngle + Math.max(sweep, 0.3),
    });
    currentAngle += share * Math.PI * 2;
  }

  for (const [type, group] of sortedTypes) {
    const angles = typeAngleMap.get(type)!;
    const count = group.length;
    const isSmall = count <= 3;

    const importanceSum = group.reduce((s, n) => s + n.importance, 0) || 1;
    const importanceNorm = group.map((n) => n.importance / importanceSum);

    if (isSmall) {
      group.forEach((node, i) => {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const angle = angles.startAngle + t * (angles.endAngle - angles.startAngle);
        const minR = layoutRadius * 0.5;
        const maxR = layoutRadius * 0.85;
        const r = minR + (1 - importanceNorm[i]) * (maxR - minR);
        node.x = Math.cos(angle) * r;
        node.y = Math.sin(angle) * r;
        node.fx = null;
        node.fy = null;
      });
    } else {
      const rings: GraphNode[][] = [];
      let remaining = [...group];
      let ringIndex = 0;
      while (remaining.length > 0) {
        const ringCapacity = Math.max(6, Math.floor(8 + ringIndex * 5));
        rings.push(remaining.slice(0, ringCapacity));
        remaining = remaining.slice(ringCapacity);
        ringIndex++;
      }

      rings.forEach((ring, ri) => {
        const rMin = layoutRadius * (0.45 + ri * 0.35);
        const rMax = layoutRadius * (0.45 + (ri + 1) * 0.35);
        ring.forEach((node, i) => {
          const t = ring.length === 1 ? 0.5 : i / (ring.length - 1);
          const angle = angles.startAngle + t * (angles.endAngle - angles.startAngle);
          const r = rMin + (1 - (node.importance / 10)) * (rMax - rMin);
          node.x = Math.cos(angle) * r;
          node.y = Math.sin(angle) * r;
          node.fx = null;
          node.fy = null;
        });
      });
    }
  }

  resolveCollisions(nodes, baseSpacing * 0.6);
}

function resolveCollisions(nodes: GraphNode[], minDist: number): void {
  const iterations = 40;
  const conceptNodes = nodes.filter((n) => (n.kind ?? "concept") === "concept");
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < conceptNodes.length; i++) {
      for (let j = i + 1; j < conceptNodes.length; j++) {
        const a = conceptNodes[i];
        const b = conceptNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const needed = minDist + (a.radius || 12) + (b.radius || 12);
        if (dist < needed && dist > 0.01) {
          const overlap = (needed - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          if (!a.held && a.fx == null) {
            a.x -= nx * overlap * 0.5;
            a.y -= ny * overlap * 0.5;
          }
          if (!b.held && b.fx == null) {
            b.x += nx * overlap * 0.5;
            b.y += ny * overlap * 0.5;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}