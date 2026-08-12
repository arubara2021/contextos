// FILE: src/ingestion/parsers/docx-parser.ts

import type {
  ParsedDocument,
  StructuralFingerprint,
  DocumentSection,
  EmbeddedFileMetadata,
} from "../../types/ingestion.types";

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const errors: string[] = [];
  let mammoth: any;

  try {
    mammoth = await import("mammoth");
  } catch {
    errors.push("mammoth not installed. Run: npm install mammoth");
    return emptyResult(errors);
  }

  let rawText: string;
  let messages: any[];

  try {
    const result = await mammoth.extractRawText({ buffer });
    rawText = result.value || "";
    messages = result.messages || [];
  } catch (err) {
    errors.push(`DOCX parse error: ${(err as Error).message}`);
    return emptyResult(errors);
  }

  for (const msg of messages) {
    if (msg.type === "warning") {
      errors.push(msg.message);
    }
  }

  if (rawText.trim().length < 10) {
    errors.push("DOCX contains no extractable text");
    return emptyResult(errors);
  }

  const cleaned = cleanDocxText(rawText);
  const sections = detectSections(cleaned);
  const embedded = extractEmbeddedMetadata(cleaned, sections);
  const fingerprint = buildFingerprint(cleaned, sections, embedded);

  return {
    format: "docx",
    text: cleaned,
    structure: fingerprint,
    sections,
    parseErrors: errors,
  };
}

function cleanDocxText(text: string): string {
  let r = text;

  r = r.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  r = r.replace(/\u00A0/g, " ");
  r = r.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  r = r.replace(/[\u201C\u201D]/g, '"');
  r = r.replace(/[\u2018\u2019]/g, "'");
  r = r.replace(/\u2013/g, "-");
  r = r.replace(/\u2014/g, " -- ");
  r = r.replace(/\u2026/g, "...");

  r = removePageNumberLines(r);
  r = removeHeaderFooterLines(r);

  r = r.replace(/[ \t]+$/gm, "");
  r = r.replace(/\n{4,}/g, "\n\n\n");
  r = r.replace(/ {2,}/g, " ");

  return r.trim();
}

function removePageNumberLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^\d{1,4}$/.test(t)) return false;
      if (/^Page\s+\d{1,4}\s*(?:of\s+\d{1,4})?$/i.test(t)) return false;
      if (/^\d{1,4}\s*\/\s*\d{1,4}$/.test(t)) return false;
      return true;
    })
    .join("\n");
}

function removeHeaderFooterLines(text: string): string {
  const lines = text.split("\n");
  const freq = new Map<string, number>();

  for (const line of lines) {
    const t = line.trim();
    if (t.length >= 3 && t.length <= 80) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.floor(lines.length * 0.15));
  const repeated = new Set<string>();
  for (const [line, count] of freq) {
    if (count >= threshold) repeated.add(line);
  }

  if (repeated.size === 0) return text;
  return lines.filter((line) => !repeated.has(line.trim())).join("\n");
}

function detectSections(text: string): DocumentSection[] {
  const lines = text.split("\n");
  const found: DocumentSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const numbered = line.match(/^(\d+(?:\.\d+)*)\s+([A-Z].{2,80})$/);
    if (numbered) {
      found.push({
        heading: numbered[2].trim(),
        level: numbered[1].split(".").length,
        text: "",
        startIndex: i,
        endIndex: i,
      });
      continue;
    }

    if (/^[A-Z][A-Z\s]{3,50}$/.test(line) && line.length < 60) {
      found.push({ heading: line, level: 1, text: "", startIndex: i, endIndex: i });
      continue;
    }

    if (
      line.length > 5 && line.length < 60 && /^[A-Z]/.test(line) &&
      !/[.;,]$/.test(line) && i > 0 && !lines[i - 1].trim() &&
      i < lines.length - 1 && lines[i + 1].trim().length > line.length &&
      line.split(/\s+/).length <= 8
    ) {
      found.push({ heading: line, level: 2, text: "", startIndex: i, endIndex: i });
    }
  }

  if (found.length > 0 && found[0].startIndex > 0) {
    const preamble = lines.slice(0, found[0].startIndex).join("\n").trim();
    if (preamble.length > 200) {
      found.unshift({ heading: null, level: 0, text: preamble, startIndex: 0, endIndex: found[0].startIndex });
    }
  }

  for (let i = 0; i < found.length; i++) {
    if (found[i].heading === null && found[i].text) continue;
    const start = found[i].startIndex + 1;
    const end = i + 1 < found.length ? found[i + 1].startIndex : lines.length;
    found[i].text = lines.slice(start, end).join("\n").trim();
    found[i].endIndex = end;
  }

  return found.filter((s) => {
    if (s.heading === null) return true;
    const h = s.heading.trim();
    if (h.length < 3) return false;
    const words = h.split(/\s+/);
    if (words.length >= 2 && words.every((w) => w.length <= 1)) return false;
    if (/^\d+$/.test(h)) return false;
    return true;
  });
}

function extractEmbeddedMetadata(
  text: string,
  sections: DocumentSection[]
): EmbeddedFileMetadata {
  let title: string | null = null;
  if (sections.length > 0 && sections[0].heading) {
    title = sections[0].heading;
  } else {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const first = lines[0].trim();
      if (first.length >= 5 && first.length <= 250 && !/^\d/.test(first)) {
        title = first;
      }
    }
  }

  return { title, author: null, date: null, subject: null, creator: null, pageCount: null };
}

function hasReferences(text: string): boolean {
  return /(?:^|\n)\s*(?:references|bibliography|works\s+cited)\s*$/im.test(text);
}

function countCitations(text: string): number {
  const seen = new Set<string>();
  const bracket = text.match(/$$\d+(?:[,\s\-]+\d+)*$$/g);
  if (bracket) for (const m of bracket) { const nums = m.match(/\d+/g); if (nums) nums.forEach((n) => seen.add("b" + n)); }
  const ay = text.match(/$$[A-Z][a-z]+(?:\s+(?:et\s+al\.?|and|&)\s+[A-Z][a-z]+)?,?\s*\d{4}[a-z]?$$/g);
  if (ay) ay.forEach((m) => seen.add(m));
  return seen.size;
}

function hasFormulas(text: string): boolean {
  return [/\$[^$]+\$/, /\\frac\{|\\sum\b|\\int\b/, /[∑∏∫∂∇√∞≈≠≤≥±]/, /\b(?:theorem|lemma|corollary|proof)\s*\d/i].some((p) => p.test(text));
}

function countWords(text: string): number { return text.split(/\s+/).filter((w) => w.length > 0).length; }
function countParagraphs(text: string): number { return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length; }

function detectLanguage(text: string): string {
  const sample = text.substring(0, 2000).toLowerCase();
  const words = sample.split(/\s+/);
  const scores: Record<string, number> = {
    en: ["the","and","for","that","this","with","from","have","are","was"].filter((w) => words.includes(w)).length,
    es: ["el","la","los","las","del","por","que","con","una","para"].filter((w) => words.includes(w)).length,
    fr: ["les","des","une","est","que","pour","dans","par","sur","pas"].filter((w) => words.includes(w)).length,
    de: ["der","die","und","ist","von","den","das","nicht","sich","auf"].filter((w) => words.includes(w)).length,
  };
  const max = Math.max(...Object.values(scores));
  if (max === 0) return "en";
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function buildFingerprint(
  text: string,
  sections: DocumentSection[],
  embedded: EmbeddedFileMetadata
): StructuralFingerprint {
  const wc = countWords(text);
  const pc = countParagraphs(text);
  return {
    wordCount: wc, pageCount: null, sectionCount: sections.length,
    hasReferences: hasReferences(text), hasFormulas: hasFormulas(text),
    hasCodeBlocks: /```[\s\S]*?```/.test(text) || /(?:^|\n)(?:def |class |import |from |function |const |let |var )/m.test(text),
    hasTables: /\|[^|]+\|[^|]+\|/.test(text) || /\t[^\t]+\t[^\t]+\t/.test(text),
    hasImages: false,
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
    format: "docx", text: "", parseErrors: errors, sections: [],
    structure: {
      wordCount: 0, pageCount: null, sectionCount: 0, hasReferences: false,
      hasFormulas: false, hasCodeBlocks: false, hasTables: false, hasImages: false,
      hasNumberedSections: false, headings: [], firstChunk: "", lastChunk: "",
      citationCount: 0, avgParagraphLength: 0, language: "en",
      embeddedMetadata: { title: null, author: null, date: null, subject: null, creator: null, pageCount: null },
    },
  };
}