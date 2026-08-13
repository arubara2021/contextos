import type {
  ParsedDocument,
  StructuralFingerprint,
  DocumentSection,
  EmbeddedFileMetadata,
} from "../../types/ingestion.types";
import { cleanPdfText } from "../../utils/text-cleaner";
import logger from "../../utils/logger";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
let pdfjsLib: any = null;
let pdfjsChecked = false;

const PDFJS_CANDIDATES = [
  "pdfjs-dist/legacy/build/pdf.mjs",
  "pdfjs-dist/legacy/build/pdf.js",
  "pdfjs-dist/legacy/build/pdf.min.mjs",
  "pdfjs-dist/legacy/build/pdf.min.js",
  "pdfjs-dist/build/pdf.mjs",
  "pdfjs-dist/build/pdf.js",
  "pdfjs-dist",
];

async function loadPdfjs(): Promise<any> {
  if (pdfjsChecked) return pdfjsLib;
  pdfjsChecked = true;

  const candidates = [
    "pdfjs-dist/legacy/build/pdf.mjs",
    "pdfjs-dist/legacy/build/pdf.js",
    "pdfjs-dist/build/pdf.mjs",
    "pdfjs-dist/build/pdf.js",
    "pdfjs-dist",
  ];

  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      const lib = mod && (typeof mod.getDocument === "function" ? mod : mod.default);
      if (lib && typeof lib.getDocument === "function") {
        pdfjsLib = lib;
        logger.info("pdfjs-dist loaded", { candidate });
        return pdfjsLib;
      }
      errors.push(`${candidate}: no getDocument export`);
    } catch (err) {
      errors.push(`${candidate}: ${(err as Error).message}`);
    }
  }

  logger.warn("pdfjs-dist could not be loaded", { errors });
  pdfjsLib = null;
  return null;
}

function getStandardFontDataUrl(): string {
  return "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/standard_fonts/";
}
function getPdfWorkerSrc(): string {
  return "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
}
interface PageTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

interface GroupedLine {
  items: PageTextItem[];
  y: number;
}

interface PageResult {
  pageNumber: number;
  items: PageTextItem[];
  width: number;
  height: number;
  text: string;
  hasHeadingMarkers: boolean;
}

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const errors: string[] = [];
  const lib = await loadPdfjs();

  if (!lib) {
    return tryFallbackPdfParse(buffer, errors);
  }

  let pdf: any;
  try {
    if (lib.GlobalWorkerOptions) {
      try {
        lib.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc();
      } catch {
        /* ignore */
      }
    }
    const fontUrl = getStandardFontDataUrl();
    const loadingTask = lib.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: fontUrl || undefined,
      disableFontFace: true,
      useSystemFonts: true,
      isEvalSupported: false,
      stopAtErrors: false,
    });
    pdf = await loadingTask.promise;
  } catch (err) {
    errors.push(`pdfjs-dist document load error: ${(err as Error).message}`);
    logger.warn("pdfjs-dist document load failed, using pdf-parse fallback", {
      error: (err as Error).message,
    });
    return tryFallbackPdfParse(buffer, errors);
  }

  const pageCount: number = pdf.numPages || 0;
  let info: any = {};
  try {
    const meta = await pdf.getMetadata();
    info = meta?.info || {};
  } catch {
    /* ignore */
  }

  const pages: PageResult[] = [];
  let totalItemsFound = 0;
  let totalItemsWithText = 0;

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ includeMarkedContent: true });
      const items: PageTextItem[] = [];

      for (const item of content.items || []) {
        totalItemsFound++;
        if (!item.str || !item.str.trim()) continue;
        if (!item.transform || item.transform.length < 6) continue;
        totalItemsWithText++;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 0,
          height: Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 0,
          fontName: item.fontName || "",
        });
      }

      pages.push(processPage(items, viewport.width, viewport.height, i));
    } catch (err) {
      errors.push(`Page ${i} error: ${(err as Error).message}`);
    }
  }

  if (pages.length === 0) {
    errors.push("No pages extracted");
    return emptyResult(errors);
  }

  const parts: string[] = [];
  for (const p of pages) {
    if (p.text.trim()) parts.push(`[Page ${p.pageNumber}]\n${p.text}`);
  }
  const rawText = cleanPdfText(parts.join("\n"));
  const wordCount = rawText.split(/\s+/).filter((w) => w.length > 0).length;

  logger.info("PDF parse complete", {
    pages: pageCount,
    pagesWithText: parts.length,
    totalItemsFound,
    totalItemsWithText,
    extractedWords: wordCount,
    extractedChars: rawText.length,
  });

  if (pageCount > 0 && wordCount < pageCount * 20) {
    logger.warn("PDF extraction yielded suspiciously low text", {
      pages: pageCount,
      words: wordCount,
      expectedMinimum: pageCount * 20,
      itemsFound: totalItemsFound,
      itemsWithText: totalItemsWithText,
      hint:
        totalItemsFound > 0 && totalItemsWithText < totalItemsFound * 0.3
          ? "Most text items decoded to empty strings - embedded font issue. If useSystemFonts/standard fonts still fail, this PDF may need OCR."
          : "Very few text items per page - the PDF is likely image-based (scanned) and requires OCR to extract anything.",
    });
  }

  if (rawText.trim().length < 10) {
    errors.push("PDF contains no extractable text");
    return emptyResult(errors);
  }

  const bodyOnly = stripBackMatter(rawText);
  const embedded = buildMetadata(info, pageCount);
  const sections = detectSections(bodyOnly);
  const titleGuess = embedded.title || guessTitle(bodyOnly);
  if (titleGuess && !embedded.title) embedded.title = titleGuess;
  const fingerprint = buildFingerprint(bodyOnly, sections, embedded, pageCount);

  return {
    format: "pdf",
    text: bodyOnly,
    structure: fingerprint,
    sections,
    parseErrors: errors,
  };
}

function processPage(
  items: PageTextItem[],
  width: number,
  height: number,
  pageNum: number
): PageResult {
  if (items.length === 0) {
    return {
      pageNumber: pageNum,
      items: [],
      width,
      height,
      text: "",
      hasHeadingMarkers: false,
    };
  }

  const footerY = height * 0.04;
  const headerY = height * 0.96;
  const filtered = items.filter((it) => it.y > footerY && it.y < headerY);

  const fontSizes = filtered.filter((i) => i.height > 1).map((i) => i.height);
  const bodyFontSize = fontSizes.length > 0 ? median(fontSizes) : 10;
  const headingThreshold = bodyFontSize * 1.3;

  const columns = detectColumns(filtered);
  const lines =
    columns.length > 1
      ? buildMultiColumnLines(filtered, columns, width)
      : buildSingleColumnLines(filtered);

  let hasHeadingMarkers = false;
  const textParts: string[] = [];

  for (const line of lines) {
    const lineHeight = Math.max(...line.items.map((i) => i.height));
    const lineText = line.items.map((i) => i.str).join("").trim();
    if (!lineText) continue;

    const isBold = line.items.some((i) => /bold/i.test(i.fontName));
    const isLarge = lineHeight >= headingThreshold;
    const isPattern = isHeadingPattern(lineText);

    if ((isLarge || isBold) && isPattern) {
      textParts.push("## " + lineText);
      hasHeadingMarkers = true;
    } else {
      textParts.push(reconstructWithSpacing(line.items));
    }
  }

  return {
    pageNumber: pageNum,
    items: filtered,
    width,
    height,
    text: textParts.join("\n"),
    hasHeadingMarkers,
  };
}

function buildSingleColumnLines(items: PageTextItem[]): GroupedLine[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: GroupedLine[] = [];
  let current: PageTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) > 4) {
      groups.push({ items: current, y: currentY });
      current = [sorted[i]];
      currentY = sorted[i].y;
    } else {
      current.push(sorted[i]);
      currentY = (currentY * (current.length - 1) + sorted[i].y) / current.length;
    }
  }
  groups.push({ items: current, y: currentY });
  for (const g of groups) g.items.sort((a, b) => a.x - b.x);
  return groups;
}

function buildMultiColumnLines(
  items: PageTextItem[],
  columns: number[],
  pageWidth: number
): GroupedLine[] {
  const columnItems: Map<number, PageTextItem[]> = new Map();
  for (let i = 0; i < columns.length; i++) columnItems.set(i, []);

  for (const item of items) {
    if (item.width > pageWidth * 0.5) {
      columnItems.get(0)!.push(item);
      continue;
    }
    columnItems.get(nearestColumn(item.x, columns))!.push(item);
  }

  const allLines: GroupedLine[] = [];
  for (let i = 0; i < columns.length; i++) {
    const colItems = columnItems.get(i) || [];
    if (colItems.length === 0) continue;
    allLines.push(...buildSingleColumnLines(colItems));
  }
  allLines.sort((a, b) => b.y - a.y);
  return allLines;
}

function detectColumns(items: PageTextItem[]): number[] {
  const xRounded = items.map((it) => Math.round(it.x / 5) * 5);
  const freq = new Map<number, number>();
  for (const x of xRounded) freq.set(x, (freq.get(x) || 0) + 1);

  const threshold = Math.max(3, Math.floor(items.length * 0.05));
  const significant = [...freq.entries()]
    .filter(([, c]) => c >= threshold)
    .map(([x]) => x)
    .sort((a, b) => a - b);

  if (significant.length <= 1) return significant;

  const columns: number[] = [];
  let sum = significant[0];
  let count = 1;
  for (let i = 1; i < significant.length; i++) {
    if (significant[i] - significant[i - 1] < 25) {
      sum += significant[i];
      count++;
    } else {
      columns.push(Math.round(sum / count));
      sum = significant[i];
      count = 1;
    }
  }
  columns.push(Math.round(sum / count));
  return columns;
}

function nearestColumn(x: number, columns: number[]): number {
  if (columns.length <= 1) return 0;
  let nearest = 0;
  let minDist = Math.abs(x - columns[0]);
  for (let i = 1; i < columns.length; i++) {
    const dist = Math.abs(x - columns[i]);
    if (dist < minDist) {
      minDist = dist;
      nearest = i;
    }
  }
  return nearest;
}

function reconstructWithSpacing(items: PageTextItem[]): string {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      const gap = items[i].x - (items[i - 1].x + items[i - 1].width);
      const avgH = (items[i].height + items[i - 1].height) / 2;
      if (gap > avgH * 0.3) parts.push(" ");
    }
    parts.push(items[i].str);
  }
  return parts.join("");
}

function isHeadingPattern(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return false;
  if (/^\d{1,4}$/.test(trimmed)) return false;
  if (/^page\s+\d/i.test(trimmed)) return false;
  if (/[{}()<>]/.test(trimmed)) return false;
  if (/[=;+]/.test(trimmed)) return false;
  if (/^\d+(?:\.\d+)*\s+[A-Z][a-zA-Z\s]{2,80}$/.test(trimmed)) return true;
  if (/^[A-Z][A-Z\s]{3,50}$/.test(trimmed) && trimmed.length < 60 && !/\d/.test(trimmed))
    return true;
  const words = trimmed.split(/\s+/);
  if (
    words.length <= 6 &&
    /^[A-Z]/.test(trimmed) &&
    !/[.;,]$/.test(trimmed) &&
    !/\d/.test(trimmed)
  ) {
    const titleCase = words.filter((w) => /^[A-Z]/.test(w)).length;
    if (titleCase >= words.length * 0.6) return true;
  }
  return false;
}

function median(values: number[]): number {
  if (values.length === 0) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function detectSections(text: string): DocumentSection[] {
  const lines = text.split("\n");
  const found: DocumentSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\[Page\s+\d+\]$/.test(line)) continue;

    if (lines[i].startsWith("## ")) {
      const heading = lines[i].substring(3).trim();
      if (heading.length >= 3 && isStrictHeading(heading)) {
        found.push({ heading, level: 1, text: "", startIndex: i, endIndex: i });
      }
      continue;
    }

    if (!line || line.length < 3 || line.length > 120) continue;
    if (/[{}()<>]/.test(line)) continue;
    if (/^\d{1,4}$/.test(line)) continue;
    if (/^page\s+\d/i.test(line)) continue;

    const numbered = line.match(/^(\d+(?:\.\d+)*)\s+([A-Z][a-zA-Z\s&,;:\-]{2,80})$/);
    if (numbered && isStrictHeading(numbered[2].trim())) {
      found.push({
        heading: numbered[2].trim(),
        level: numbered[1].split(".").length,
        text: "",
        startIndex: i,
        endIndex: i,
      });
      continue;
    }

    if (/^[A-Z][A-Z\s]{3,50}$/.test(line) && line.length < 60 && !/\d/.test(line)) {
      if (isStrictHeading(line)) {
        found.push({ heading: line, level: 1, text: "", startIndex: i, endIndex: i });
      }
    }
  }

  found.sort((a, b) => a.startIndex - b.startIndex);

  for (let i = 0; i < found.length; i++) {
    if (found[i].heading === null && found[i].text) continue;
    const start = found[i].startIndex + 1;
    const end = i + 1 < found.length ? found[i + 1].startIndex : lines.length;
    found[i].text = lines
      .slice(start, end)
      .filter((l) => !/^\[Page\s+\d+\]$/.test(l.trim()))
      .join("\n")
      .trim();
    found[i].endIndex = end;
  }

  if (found.length > 0 && found[0].startIndex > 0) {
    const preamble = lines
      .slice(0, found[0].startIndex)
      .filter((l) => !/^\[Page\s+\d+\]$/.test(l.trim()))
      .join("\n")
      .trim();
    if (preamble.length > 200) {
      found.unshift({
        heading: null,
        level: 0,
        text: preamble,
        startIndex: 0,
        endIndex: found[0].startIndex,
      });
    }
  }

  const merged = mergeSmallSections(found, 100);
  return merged.filter((s) => {
    if (s.heading === null) return true;
    if (s.heading.length < 3) return false;
    if (/^\d+$/.test(s.heading)) return false;
    const words = s.heading.split(/\s+/);
    if (words.length >= 2 && words.every((w) => w.length <= 1)) return false;
    return true;
  });
}

function isStrictHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 100) return false;
  if (/[{}()<>]/.test(trimmed)) return false;
  if (/[=;+]/.test(trimmed)) return false;
  if (/\sv\.\s/.test(trimmed)) return false;
  if (/Ibid|p\.\s*\d+/.test(trimmed)) return false;
  if (/^\d{1,4}$/.test(trimmed)) return false;
  if (/^page\s+\d/i.test(trimmed)) return false;
  if (/[;,]$/.test(trimmed)) return false;
  if (/\d/.test(trimmed) && !/^\d+(?:\.\d+)*\s+/.test(trimmed)) return false;
  if (/^\d+(?:\.\d+)*\s+[A-Z]/.test(trimmed)) return true;
  if (/^[A-Z][A-Z\s]{3,50}$/.test(trimmed) && trimmed.length < 60) return true;
  return false;
}

function mergeSmallSections(
  sections: DocumentSection[],
  minWords: number
): DocumentSection[] {
  if (sections.length <= 1) return sections;
  const result: DocumentSection[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const wordCount = section.text.split(/\s+/).filter((w) => w.length > 0).length;
    const isNumbered = section.heading && /^\d+(?:\.\d+)*\s+/.test(section.heading);
    if (
      !isNumbered &&
      section.heading !== null &&
      wordCount < minWords &&
      result.length > 0
    ) {
      const prev = result[result.length - 1];
      const prefix = section.heading ? section.heading + "\n" : "";
      prev.text = (prev.text + "\n" + prefix + section.text).trim();
      prev.endIndex = section.endIndex;
    } else {
      result.push({ ...section });
    }
  }
  return result;
}

function stripBackMatter(text: string): string {
  const lines = text.split("\n");
  let cutoff = lines.length;
  const scanFrom = Math.floor(lines.length * 0.5);
  for (let i = lines.length - 1; i >= scanFrom; i--) {
    const t = lines[i].trim().replace(/^\[Page\s+\d+\]\s*$/, "").trim();
    if (/^(?:references|bibliography|works cited|literature cited)\s*$/i.test(t)) {
      cutoff = i;
      break;
    }
    if (/^(?:subject index|author index|name index|general index)\s*$/i.test(t)) {
      cutoff = i;
      break;
    }
    if (/^index\s*$/i.test(t) && i > lines.length * 0.7) {
      cutoff = i;
      break;
    }
    if (/^(?:about the (?:author|editor|publisher))\s*$/i.test(t)) {
      cutoff = i;
      break;
    }
  }
  return cutoff < lines.length ? lines.slice(0, cutoff).join("\n").trim() : text;
}

function buildMetadata(info: any, pageCount: number | null): EmbeddedFileMetadata {
  return {
    title: info.Title || info.title || null,
    author: info.Author || info.author || null,
    date: info.CreationDate || info.ModDate || info.creationDate || null,
    subject: info.Subject || info.subject || null,
    creator: info.Creator || info.Producer || info.creator || null,
    pageCount,
  };
}

function guessTitle(text: string): string | null {
  const lines = text
    .split("\n")
    .filter((l) => l.trim().length > 0 && !/^\[Page\s+\d+\]$/.test(l.trim()));
  if (lines.length === 0) return null;
  const first = lines[0].replace(/^##\s+/, "").trim();
  if (first.length >= 5 && first.length <= 250 && !/^\d/.test(first)) return first;
  return null;
}

function hasReferences(text: string): boolean {
  return /(?:^|\n)\s*(?:references|bibliography|works\s+cited)\s*$/im.test(text);
}

function countCitations(text: string): number {
  const seen = new Set<string>();
  const bracket = text.match(/\[\d+(?:[,\s\-]+\d+)*\]/g);
  if (bracket)
    for (const m of bracket) {
      const nums = m.match(/\d+/g);
      if (nums) nums.forEach((n) => seen.add("b" + n));
    }
  const ay = text.match(
    /\([A-Z][a-z]+(?:\s+(?:et\s+al\.?|and|&)\s+[A-Z][a-z]+)?,?\s*\d{4}[a-z]?\)/g
  );
  if (ay) ay.forEach((m) => seen.add(m));
  return seen.size;
}

function hasFormulas(text: string): boolean {
  return [
    /\$[^$]+\$/,
    /\\frac\{|\\sum\b|\\int\b/,
    /[∑∏∫∂∇√∞≈≠≤≥±]/,
    /\b(?:theorem|lemma|corollary|proof)\s*\d/i,
  ].some((p) => p.test(text));
}

function hasCodeBlocks(text: string): boolean {
  return (
    /```[\s\S]*?```/.test(text) ||
    /(?:^|\n)(?:def |class |import |from |function |const |let |var )/m.test(text)
  );
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
}

function detectLanguage(text: string): string {
  const sample = text.substring(0, 2000).toLowerCase();
  const words = sample.split(/\s+/);
  const scores: Record<string, number> = {
    en: ["the", "and", "for", "that", "this", "with", "from", "have", "are", "was"].filter((w) =>
      words.includes(w)
    ).length,
    es: ["el", "la", "los", "las", "del", "por", "que", "con", "una", "para"].filter((w) =>
      words.includes(w)
    ).length,
    fr: ["les", "des", "une", "est", "que", "pour", "dans", "par", "sur", "pas"].filter((w) =>
      words.includes(w)
    ).length,
    de: ["der", "die", "und", "ist", "von", "den", "das", "nicht", "sich", "auf"].filter((w) =>
      words.includes(w)
    ).length,
  };
  const max = Math.max(...Object.values(scores));
  if (max === 0) return "en";
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function buildFingerprint(
  text: string,
  sections: DocumentSection[],
  embedded: EmbeddedFileMetadata,
  pageCount: number | null
): StructuralFingerprint {
  const wc = countWords(text);
  const pc = countParagraphs(text);
  return {
    wordCount: wc,
    pageCount,
    sectionCount: sections.length,
    hasReferences: hasReferences(text),
    hasFormulas: hasFormulas(text),
    hasCodeBlocks: hasCodeBlocks(text),
    hasTables: /\|[^|]+\|[^|]+\|/.test(text),
    hasImages: /fig(?:ure)?\.?\s*\d+/i.test(text),
    hasNumberedSections: (text.match(/^\d+\.\s+[A-Z]/gm) || []).length >= 2,
    headings: sections.filter((s) => s.heading).map((s) => s.heading!),
    firstChunk: text.substring(0, 2000),
    lastChunk: text.substring(Math.max(0, text.length - 2000)),
    citationCount: countCitations(text),
    avgParagraphLength: Math.round(wc / Math.max(1, pc)),
    language: detectLanguage(text),
    embeddedMetadata: embedded,
  };
}

function emptyResult(errors: string[]): ParsedDocument {
  return {
    format: "pdf",
    text: "",
    parseErrors: errors,
    sections: [],
    structure: {
      wordCount: 0,
      pageCount: null,
      sectionCount: 0,
      hasReferences: false,
      hasFormulas: false,
      hasCodeBlocks: false,
      hasTables: false,
      hasImages: false,
      hasNumberedSections: false,
      headings: [],
      firstChunk: "",
      lastChunk: "",
      citationCount: 0,
      avgParagraphLength: 0,
      language: "en",
      embeddedMetadata: {
        title: null,
        author: null,
        date: null,
        subject: null,
        creator: null,
        pageCount: null,
      },
    },
  };
}

async function tryFallbackPdfParse(
  buffer: Buffer,
  errors: string[]
): Promise<ParsedDocument> {
  try {
    const data = await pdfParse(buffer);
    let rawText = typeof data.text === "string" ? data.text : "";
    const pageCount = typeof data.numpages === "number" ? data.numpages : null;
    const info = data.info || {};

    rawText = cleanPdfText(rawText);
    const wordCount = rawText.split(/\s+/).filter((w: string) => w.length > 0).length;
    logger.info("PDF fallback parse complete", {
      pages: pageCount,
      extractedWords: wordCount,
      extractedChars: rawText.length,
    });

    if (rawText.trim().length < 10) {
      errors.push("PDF contains no extractable text");
      return emptyResult(errors);
    }

    const bodyOnly = stripBackMatter(rawText);
    const embedded = buildMetadata(info, pageCount);
    const sections = detectSections(bodyOnly);
    const titleGuess = embedded.title || guessTitle(bodyOnly);
    if (titleGuess && !embedded.title) embedded.title = titleGuess;
    const fingerprint = buildFingerprint(bodyOnly, sections, embedded, pageCount);

    return {
      format: "pdf",
      text: bodyOnly,
      structure: fingerprint,
      sections,
      parseErrors: errors,
    };
  } catch (err) {
    errors.push(`pdf-parse error: ${(err as Error).message}`);
    return emptyResult(errors);
  }
}