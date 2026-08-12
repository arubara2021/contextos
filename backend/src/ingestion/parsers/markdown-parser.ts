// FILE: src/ingestion/parsers/markdown-parser.ts

import type {
  ParsedDocument,
  StructuralFingerprint,
  DocumentSection,
  EmbeddedFileMetadata,
} from "../../types/ingestion.types";

export function parseMarkdown(buffer: Buffer): ParsedDocument {
  let content = buffer.toString("utf-8");
  const errors: string[] = [];

  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.substring(1);
  }

  content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (content.trim().length < 10) {
    errors.push("Markdown file is empty or too short");
    return emptyResult(errors);
  }

  const sections = extractSections(content);
  const codeBlocks = extractCodeBlocks(content);
  const cleanText = stripFormatting(content);
  const embedded = extractFrontmatter(content, sections);
  const fingerprint = buildFingerprint(cleanText, sections, codeBlocks, embedded);

  return {
    format: "md",
    text: cleanText,
    structure: fingerprint,
    sections,
    parseErrors: errors,
  };
}

function extractSections(text: string): DocumentSection[] {
  const lines = text.split("\n");
  const found: DocumentSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      found.push({
        heading: match[2].replace(/[#*_`\[\]]/g, "").replace(/\r$/, "").trim(),
        level: match[1].length,
        text: "",
        startIndex: i,
        endIndex: i,
      });
    }
  }

  for (let i = 0; i < found.length; i++) {
    const start = found[i].startIndex + 1;
    const end = i + 1 < found.length ? found[i + 1].startIndex : lines.length;
    found[i].text = lines.slice(start, end).join("\n").trim();
    found[i].endIndex = end;
  }

  return found;
}

function extractCodeBlocks(text: string): { language: string; code: string }[] {
  const pattern = /```(\w*)\n([\s\S]*?)```/g;
  const blocks: { language: string; code: string }[] = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    blocks.push({
      language: match[1] || "unknown",
      code: match[2].trim(),
    });
  }

  return blocks;
}

function stripFormatting(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => code.trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/!\[([^\]\[]*)\]\([^)]+\)$$/g, "$1")
    .replace(/$$([^$$$$]*)$$$$[^)]+$$/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "  ")
    .replace(/^\d+\.\s+/gm, "  ")
    .replace(/^---+$/gm, "")
    .replace(/^\*\*\*+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFrontmatter(
  content: string,
  sections: DocumentSection[]
): EmbeddedFileMetadata {
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (yamlMatch) {
    const body = yamlMatch[1];
    const title = body.match(/title:\s*["']?(.+?)["']?\s*$/m);
    const author = body.match(/author:\s*["']?(.+?)["']?\s*$/m);
    const date = body.match(/date:\s*["']?(.+?)["']?\s*$/m);
    const description = body.match(/description:\s*["']?(.+?)["']?\s*$/m);

    return {
      title: title ? title[1].trim() : null,
      author: author ? author[1].trim() : null,
      date: date ? date[1].trim() : null,
      subject: description ? description[1].trim() : null,
      creator: null,
      pageCount: null,
    };
  }

  let title: string | null = null;
  if (sections.length > 0 && sections[0].level === 1) {
    title = sections[0].heading;
  } else {
    const firstHeading = content.match(/^#\s+(.+)$/m);
    if (firstHeading) title = firstHeading[1].replace(/[#*_`$$]/g, "").trim();
  }

  return { title, author: null, date: null, subject: null, creator: null, pageCount: null };
}

function hasReferences(text: string): boolean {
  return /(?:^|\n)\s*(?:references|bibliography|works\s+cited)\s*$/im.test(text);
}

function countCitations(text: string): number {
  const seen = new Set<string>();
  const bracket = text.match(/\[\d+(?:[,\s\-]+\d+)*\]$$/g);
  if (bracket) {
    for (const m of bracket) {
      const nums = m.match(/\d+/g);
      if (nums) nums.forEach((n) => seen.add("b" + n));
    }
  }
  const ay = text.match(
    /$$[A-Z][a-z]+(?:\s+(?:et\s+al\.?|and|&)\s+[A-Z][a-z]+)?,?\s*\d{4}[a-z]?$$/g
  );
  if (ay) ay.forEach((m) => seen.add(m));
  return seen.size;
}

function hasFormulas(text: string): boolean {
  return [
    /\$[^$]+\$/,
    /\\frac\{|\\sum\b|\\int\b/,
    /[∑∏∫∂∇√∞≈≠≤≥±]/,
    /\b(?:theorem|lemma|corollary|proof|proposition)\s*\d/i,
  ].some((p) => p.test(text));
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
  codeBlocks: { language: string; code: string }[],
  embedded: EmbeddedFileMetadata
): StructuralFingerprint {
  const wc = countWords(text);
  const pc = countParagraphs(text);

  return {
    wordCount: wc,
    pageCount: null,
    sectionCount: sections.length,
    hasReferences: hasReferences(text),
    hasFormulas: hasFormulas(text),
    hasCodeBlocks: codeBlocks.length > 0,
    hasTables: /\|[^|]+\|[^|]+\|/.test(text),
    hasImages: /!$$.*?$$$$.*?$$/.test(text),
    hasNumberedSections: sections.filter((s) => s.level === 1).length >= 3,
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
    format: "md",
    text: "",
    structure: {
      wordCount: 0, pageCount: null, sectionCount: 0, hasReferences: false,
      hasFormulas: false, hasCodeBlocks: false, hasTables: false, hasImages: false,
      hasNumberedSections: false, headings: [], firstChunk: "", lastChunk: "",
      citationCount: 0, avgParagraphLength: 0, language: "en",
      embeddedMetadata: { title: null, author: null, date: null, subject: null, creator: null, pageCount: null },
    },
    sections: [],
    parseErrors: errors,
  };
}