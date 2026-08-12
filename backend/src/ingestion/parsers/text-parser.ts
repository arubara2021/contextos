// FILE: src/ingestion/parsers/text-parser.ts

import type {
  FileFormat,
  ParsedDocument,
  StructuralFingerprint,
  DocumentSection,
  EmbeddedFileMetadata,
} from "../../types/ingestion.types";

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.substring(dot).toLowerCase();
}

export function parseText(
  buffer: Buffer,
  filename: string,
  format: FileFormat
): ParsedDocument {
  let content: string;
  try {
    content = decodeBuffer(buffer);
  } catch (err) {
    return emptyResult(format, [`Decode error: ${(err as Error).message}`]);
  }

  if (content.trim().length === 0) {
    return emptyResult(format, ["File is empty"]);
  }

  switch (format) {
    case "json":
      return parseJson(content);
    case "csv":
      return parseCsv(content);
    case "yaml":
      return parseYaml(content);
    case "code":
      return parseCode(content, filename);
    case "html":
      return parseHtml(content);
    default:
      return parsePlainText(content, format);
  }
}

function decodeBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.toString("utf-8").substring(1);
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.toString("utf16le").substring(1);
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const utf16be = buffer.toString("utf16le");
    return utf16be.split("").map((c) => {
      const code = c.charCodeAt(0);
      return String.fromCharCode(((code & 0xFF) << 8) | ((code >> 8) & 0xFF));
    }).join("");
  }
  return buffer.toString("utf-8");
}

function parsePlainText(content: string, format: FileFormat): ParsedDocument {
  const cleaned = normalizeWhitespace(content);
  const lines = cleaned.split("\n");
  const sections = detectTextSections(lines, cleaned);

  return {
    format,
    text: cleaned,
    structure: buildTextFingerprint(cleaned, sections),
    sections,
    parseErrors: [],
  };
}

function detectTextSections(lines: string[], fullText: string): DocumentSection[] {
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

  if (found.length === 0) {
    const paragraphs = fullText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    return paragraphs.map((p, i) => ({
      heading: null, level: 0, text: p.trim(), startIndex: i, endIndex: i,
    }));
  }

  if (found.length > 0 && found[0].startIndex > 0) {
    const preamble = lines.slice(0, found[0].startIndex).join("\n").trim();
    if (preamble.length > 100) {
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

function parseJson(content: string): ParsedDocument {
  const errors: string[] = [];
  let parsed: any;

  try {
    parsed = JSON.parse(content);
  } catch {
    try {
      const fixed = content.replace(/,\s*([}\]])/g, "$1");
      parsed = JSON.parse(fixed);
    } catch {
      errors.push("Invalid JSON, falling back to plain text");
      return parsePlainText(content, "json");
    }
  }

  const sections = extractJsonSections(parsed);
  const text = sections
    .map((s) => (s.heading ? `${s.heading}:\n` : "") + s.text)
    .join("\n\n");

  return {
    format: "json",
    text,
    structure: buildSimpleFingerprint(text, sections),
    sections,
    parseErrors: errors,
  };
}

function extractJsonSections(obj: any, prefix = "", depth = 0): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const maxDepth = 3;

  if (depth > maxDepth) return sections;

  if (Array.isArray(obj)) {
    const preview =
      obj.length > 10
        ? JSON.stringify(obj.slice(0, 5), null, 2) + `\n... (${obj.length} items total)`
        : JSON.stringify(obj, null, 2);
    sections.push({
      heading: prefix || "root", level: depth + 1,
      text: preview.substring(0, 1000), startIndex: 0, endIndex: 0,
    });
    return sections;
  }

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        sections.push({ heading: fullKey, level: depth + 1, text: "null", startIndex: 0, endIndex: 0 });
      } else if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === "object") {
          sections.push({
            heading: fullKey, level: depth + 1,
            text: `${value.length} items. Sample:\n${JSON.stringify(value[0], null, 2).substring(0, 500)}`,
            startIndex: 0, endIndex: 0,
          });
        } else {
          sections.push({
            heading: fullKey, level: depth + 1,
            text: JSON.stringify(value, null, 2).substring(0, 500),
            startIndex: 0, endIndex: 0,
          });
        }
      } else if (typeof value === "object") {
        sections.push(...extractJsonSections(value, fullKey, depth + 1));
      } else {
        sections.push({ heading: fullKey, level: depth + 1, text: String(value), startIndex: 0, endIndex: 0 });
      }
    }
  }

  return sections;
}

function parseCsv(content: string): ParsedDocument {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return emptyResult("csv", ["Empty CSV"]);

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);
  const rowCount = lines.length - 1;
  const sampleRows = lines.slice(1, 6).map((l) => parseCsvLine(l, delimiter));

  const sections: DocumentSection[] = [];

  sections.push({
    heading: "Summary", level: 1,
    text: `${headers.length} columns, ${rowCount} rows\nColumns: ${headers.join(", ")}`,
    startIndex: 0, endIndex: 0,
  });

  for (let i = 0; i < headers.length; i++) {
    const values = sampleRows.map((r) => r[i] || "").filter(Boolean);
    sections.push({
      heading: headers[i], level: 2,
      text: values.join(", ") || "(empty)", startIndex: 0, endIndex: 0,
    });
  }

  const preview = lines.slice(0, 6).join("\n");
  const text = `Columns: ${headers.join(", ")}\nRows: ${rowCount}\n\n${preview}`;

  return {
    format: "csv", text, structure: buildSimpleFingerprint(text, sections),
    sections, parseErrors: [],
  };
}

function detectDelimiter(line: string): string {
  const commas = (line.match(/,/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  const semicolons = (line.match(/;/g) || []).length;
  if (tabs > commas && tabs > semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseYaml(content: string): ParsedDocument {
  const lines = content.split("\n");
  const sections: DocumentSection[] = [];
  let currentKey = "";
  let currentText = "";
  let currentLevel = 0;
  let lineIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("#")) continue;
    if (line.trim() === "---" || line.trim() === "...") continue;

    const keyMatch = line.match(/^(\s*)([\w.-]+)\s*:\s*(.*)/);

    if (keyMatch) {
      if (currentKey) {
        sections.push({
          heading: currentKey, level: currentLevel,
          text: currentText.trim(), startIndex: lineIdx, endIndex: i,
        });
      }
      const indent = keyMatch[1].length;
      currentKey = keyMatch[2];
      currentLevel = Math.floor(indent / 2) + 1;
      currentText = keyMatch[3] || "";
      lineIdx = i;
    } else if (line.trim().startsWith("- ")) {
      currentText += "\n" + line.trim();
    } else if (line.trim().length > 0) {
      currentText += " " + line.trim();
    }
  }

  if (currentKey) {
    sections.push({
      heading: currentKey, level: currentLevel,
      text: currentText.trim(), startIndex: lineIdx, endIndex: lines.length,
    });
  }

  const text = normalizeWhitespace(content);

  return {
    format: "yaml", text, structure: buildSimpleFingerprint(text, sections),
    sections, parseErrors: [],
  };
}

function parseCode(content: string, filename: string): ParsedDocument {
  const ext = getExtension(filename);
  const language = detectCodeLanguage(ext);
  const cleaned = normalizeWhitespace(content);
  const sections = extractCodeSections(cleaned, language);

  const text =
    sections.length > 0
      ? sections.map((s) => (s.heading ? `${s.heading}\n` : "") + s.text).join("\n\n")
      : cleaned;

  return {
    format: "code", text: cleaned,
    structure: buildCodeFingerprint(cleaned, sections, language),
    sections, parseErrors: [],
  };
}

function detectCodeLanguage(ext: string): string {
  const map: Record<string, string> = {
    ".py": "python", ".pyw": "python",
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala", ".cs": "csharp",
    ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".c": "c", ".h": "c", ".hpp": "cpp", ".hxx": "cpp",
    ".go": "go", ".rs": "rust", ".rb": "ruby", ".php": "php", ".swift": "swift", ".dart": "dart",
    ".lua": "lua", ".r": "r", ".R": "r", ".m": "objc", ".mm": "objc",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell", ".fish": "shell",
    ".ps1": "powershell", ".bat": "batch", ".cmd": "batch", ".sql": "sql",
    ".graphql": "graphql", ".gql": "graphql", ".proto": "protobuf", ".tex": "latex",
    ".bib": "bibtex", ".vue": "vue", ".svelte": "svelte", ".elm": "elm", ".hs": "haskell",
    ".ex": "elixir", ".exs": "elixir", ".erl": "erlang", ".clj": "clojure",
    ".sol": "solidity", ".tf": "terraform", ".hcl": "hcl",
  };
  return map[ext] || "unknown";
}

interface CodePattern {
  regex: RegExp;
  label: string;
  level: number;
}

function getCodePatterns(language: string): CodePattern[] {
  const map: Record<string, CodePattern[]> = {
    python: [
      { regex: /^class\s+(\w+)/, label: "Class", level: 1 },
      { regex: /^(?:async\s+)?def\s+(\w+)/, label: "Function", level: 2 },
    ],
    typescript: [
      { regex: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, label: "Class", level: 1 },
      { regex: /(?:export\s+)?interface\s+(\w+)/, label: "Interface", level: 1 },
      { regex: /(?:export\s+)?type\s+(\w+)/, label: "Type", level: 1 },
      { regex: /(?:export\s+)?enum\s+(\w+)/, label: "Enum", level: 1 },
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/, label: "Function", level: 2 },
    ],
    javascript: [
      { regex: /(?:export\s+)?class\s+(\w+)/, label: "Class", level: 1 },
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/, label: "Function", level: 2 },
      { regex: /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?$$/, label: "Arrow Function", level: 2 },
    ],
    java: [
      { regex: /(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/, label: "Class", level: 1 },
      { regex: /(?:public\s+)?interface\s+(\w+)/, label: "Interface", level: 1 },
      { regex: /(?:public|private|protected)\s+[\w<>\[]+\s+(\w+)\s*\(/, label: "Method", level: 2 },
    ],
    go: [
      { regex: /type\s+(\w+)\s+struct/, label: "Struct", level: 1 },
      { regex: /type\s+(\w+)\s+interface/, label: "Interface", level: 1 },
      { regex: /func\s+(?:\([^)]+\)$$\s+)?(\w+)/, label: "Function", level: 2 },
    ],
    rust: [
      { regex: /(?:pub\s+)?struct\s+(\w+)/, label: "Struct", level: 1 },
      { regex: /(?:pub\s+)?enum\s+(\w+)/, label: "Enum", level: 1 },
      { regex: /(?:pub\s+)?trait\s+(\w+)/, label: "Trait", level: 1 },
      { regex: /impl\s+(?:\w+\s+for\s+)?(\w+)/, label: "Impl", level: 1 },
      { regex: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, label: "Function", level: 2 },
    ],
    cpp: [
      { regex: /(?:class|struct)\s+(\w+)/, label: "Class/Struct", level: 1 },
      { regex: /(?:[\w:*&]+\s+)+(\w+)\s*$$[^)]*$$\s*(?:const\s*)?\{/, label: "Function", level: 2 },
    ],
    c: [
      { regex: /(?:struct|union|enum)\s+(\w+)/, label: "Type", level: 1 },
      { regex: /(?:[\w*]+\s+)+(\w+)\s*$$[^)]*$$\s*\{/, label: "Function", level: 2 },
    ],
    ruby: [
      { regex: /class\s+(\w+)/, label: "Class", level: 1 },
      { regex: /module\s+(\w+)/, label: "Module", level: 1 },
      { regex: /def\s+(\w+[!?]?)/, label: "Method", level: 2 },
    ],
    php: [
      { regex: /(?:abstract\s+)?class\s+(\w+)/, label: "Class", level: 1 },
      { regex: /interface\s+(\w+)/, label: "Interface", level: 1 },
      { regex: /(?:public|private|protected)\s+function\s+(\w+)/, label: "Method", level: 2 },
    ],
    shell: [
      { regex: /^(?:function\s+)?(\w+)\s*\(/, label: "Function", level: 2 },
    ],
    sql: [
      { regex: /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?(\w+)`?)/i, label: "Object", level: 1 },
    ],
    haskell: [
      { regex: /^data\s+(\w+)/, label: "Data", level: 1 },
      { regex: /^type\s+(\w+)/, label: "Type", level: 1 },
      { regex: /^class\s+(\w+)/, label: "Class", level: 1 },
      { regex: /^(\w+)\s*(?:::|∷)/, label: "Function", level: 2 },
    ],
    elixir: [
      { regex: /defmodule\s+(\w+)/, label: "Module", level: 1 },
      { regex: /def\s+(\w+)/, label: "Function", level: 2 },
    ],
    clojure: [
      { regex: /\(defn\s+(\S+)/, label: "Function", level: 2 },
      { regex: /\(defrecord\s+(\w+)/, label: "Record", level: 1 },
      { regex: /\(defprotocol\s+(\w+)/, label: "Protocol", level: 1 },
    ],
  };

  const patterns = map[language];
  if (patterns) return patterns;

  return [
    { regex: /class\s+(\w+)/, label: "Class", level: 1 },
    { regex: /function\s+(\w+)/, label: "Function", level: 2 },
    { regex: /\bdef\s+(\w+)/, label: "Function", level: 2 },
    { regex: /\bfn\s+(\w+)/, label: "Function", level: 2 },
  ];
}

function extractCodeSections(content: string, language: string): DocumentSection[] {
  const lines = content.split("\n");
  const patterns = getCodePatterns(language);
  const sections: DocumentSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("//") || line.trim().startsWith("#") || line.trim().startsWith("/*")) {
      continue;
    }

    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        const bodyEnd = findBlockEnd(lines, i);
        const docstring = extractDocstring(lines, i, language);
        const heading = `${pattern.label}: ${match[1]}`;

        sections.push({
          heading,
          level: pattern.level,
          text: (docstring ? docstring + "\n" : "") + lines.slice(i, bodyEnd + 1).join("\n"),
          startIndex: i,
          endIndex: bodyEnd,
        });
        break;
      }
    }
  }

  return sections;
}

function findBlockEnd(lines: string[], startIdx: number): number {
  const startLine = lines[startIdx];
  const openBraces = (startLine.match(/\{/g) || []).length;
  const closeBraces = (startLine.match(/\}/g) || []).length;

  if (openBraces === 0) {
    let end = startIdx;
    const indent = lines[startIdx].search(/\S/);
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) { end = i; continue; }
      const lineIndent = line.search(/\S/);
      if (lineIndent <= indent && line.trim().length > 0) break;
      end = i;
    }
    return Math.min(end, startIdx + 100);
  }

  let depth = openBraces - closeBraces;
  if (depth <= 0) return startIdx;

  for (let i = startIdx + 1; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) || []).length;
    depth -= (lines[i].match(/\}/g) || []).length;
    if (depth <= 0) return i;
  }

  return Math.min(startIdx + 100, lines.length - 1);
}

function extractDocstring(lines: string[], defLine: number, language: string): string | null {
  if (language === "python") {
    if (defLine + 1 < lines.length) {
      const next = lines[defLine + 1].trim();
      if (next.startsWith('"""') || next.startsWith("'''")) {
        const quote = next.startsWith('"""') ? '"""' : "'''";
        if (next.endsWith(quote) && next.length > 6) {
          return next.slice(3, -3).trim();
        }
        const docLines = [next.slice(3)];
        for (let i = defLine + 2; i < Math.min(defLine + 20, lines.length); i++) {
          if (lines[i].trim().endsWith(quote)) {
            docLines.push(lines[i].trim().slice(0, -3));
            return docLines.join("\n").trim();
          }
          docLines.push(lines[i].trim());
        }
      }
    }
    return null;
  }

  if (defLine > 0) {
    const prev = lines[defLine - 1].trim();
    if (prev.startsWith("/**") || prev.startsWith("/*")) {
      return prev.replace(/^\/\*\*?\s*/, "").replace(/\s*\*\/$/, "").trim();
    }
    if (prev.startsWith("//")) {
      return prev.replace(/^\/\/\s*/, "").trim();
    }
  }

  return null;
}

function parseHtml(content: string): ParsedDocument {
  const sections = extractHtmlSections(content);
  const text = stripHtml(content);

  return {
    format: "html", text, structure: buildSimpleFingerprint(text, sections),
    sections, parseErrors: [],
  };
}

function extractHtmlSections(html: string): DocumentSection[] {
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: { level: number; heading: string; pos: number; endPos: number }[] = [];

  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1]),
      heading: stripHtml(match[2]).trim(),
      pos: match.index,
      endPos: match.index + match[0].length,
    });
  }

  const sections: DocumentSection[] = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].endPos;
    const end = i + 1 < headings.length ? headings[i + 1].pos : html.length;
    sections.push({
      heading: headings[i].heading,
      level: headings[i].level,
      text: stripHtml(html.substring(start, end)).trim(),
      startIndex: headings[i].pos,
      endIndex: end,
    });
  }

  return sections;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/ {2,}/g, " ")
    .replace(/\t+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
}

function hasReferences(text: string): boolean {
  return /(?:^|\n)\s*(?:references|bibliography|works\s+cited)\s*$/im.test(text);
}

function countCitations(text: string): number {
  const seen = new Set<string>();
  const bracket = text.match(/$$\d+(?:[,\s\-]+\d+)*$$/g);
  if (bracket) for (const m of bracket) { const nums = m.match(/\d+/g); if (nums) nums.forEach((n) => seen.add("b" + n)); }
  return seen.size;
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

function buildSimpleFingerprint(text: string, sections: DocumentSection[]): StructuralFingerprint {
  const wc = countWords(text);
  const pc = countParagraphs(text);
  return {
    wordCount: wc, pageCount: null, sectionCount: sections.length,
    hasReferences: hasReferences(text), hasFormulas: /\$[^$]+\$/.test(text) || /\\frac\{|\\sum\b|\\int\b/.test(text),
    hasCodeBlocks: /```[\s\S]*?```/.test(text),
    hasTables: /\|[^|]+\|[^|]+\|/.test(text) || /\t[^\t]+\t/.test(text),
    hasImages: /fig(?:ure)?\.?\s*\d+/i.test(text),
    hasNumberedSections: (text.match(/^\d+\.\s+[A-Z]/gm) || []).length >= 2,
    headings: sections.filter((s) => s.heading).map((s) => s.heading!),
    firstChunk: text.substring(0, 2000),
    lastChunk: text.substring(Math.max(0, text.length - 2000)),
    citationCount: countCitations(text),
    avgParagraphLength: Math.round(wc / Math.max(1, pc)),
    language: detectLanguage(text),
    embeddedMetadata: { title: null, author: null, date: null, subject: null, creator: null, pageCount: null },
  };
}

function buildTextFingerprint(text: string, sections: DocumentSection[]): StructuralFingerprint {
  const wc = countWords(text);
  const pc = countParagraphs(text);
  return {
    wordCount: wc, pageCount: null, sectionCount: sections.filter((s) => s.heading !== null).length,
    hasReferences: hasReferences(text),
    hasFormulas: /\$[^$]+\$/.test(text) || /\\frac\{|\\sum\b|\\int\b/.test(text) || /[∑∏∫∂∇√∞≈≠≤≥±]/.test(text),
    hasCodeBlocks: /```[\s\S]*?```/.test(text) || /(?:^|\n)(?:def |class |import |from |function |const |let |var )/m.test(text),
    hasTables: /\|[^|]+\|[^|]+\|/.test(text) || /\t[^\t]+\t[^\t]+\t/.test(text),
    hasImages: /fig(?:ure)?\.?\s*\d+/i.test(text),
    hasNumberedSections: (text.match(/^\d+\.\s+[A-Z]/gm) || []).length >= 2,
    headings: sections.filter((s) => s.heading).map((s) => s.heading!),
    firstChunk: text.substring(0, 2000),
    lastChunk: text.substring(Math.max(0, text.length - 2000)),
    citationCount: countCitations(text),
    avgParagraphLength: Math.round(wc / Math.max(1, pc)),
    language: detectLanguage(text),
    embeddedMetadata: { title: null, author: null, date: null, subject: null, creator: null, pageCount: null },
  };
}

function buildCodeFingerprint(text: string, sections: DocumentSection[], language: string): StructuralFingerprint {
  const wc = countWords(text);
  return {
    wordCount: wc, pageCount: null, sectionCount: sections.length,
    hasReferences: false, hasFormulas: false, hasCodeBlocks: true,
    hasTables: false, hasImages: false, hasNumberedSections: false,
    headings: sections.filter((s) => s.heading).map((s) => s.heading!),
    firstChunk: text.substring(0, 2000),
    lastChunk: text.substring(Math.max(0, text.length - 2000)),
    citationCount: 0, avgParagraphLength: 0,
    language,
    embeddedMetadata: { title: null, author: null, date: null, subject: null, creator: null, pageCount: null },
  };
}

function emptyResult(format: FileFormat, errors: string[]): ParsedDocument {
  return {
    format, text: "", parseErrors: errors, sections: [],
    structure: {
      wordCount: 0, pageCount: null, sectionCount: 0, hasReferences: false,
      hasFormulas: false, hasCodeBlocks: false, hasTables: false, hasImages: false,
      hasNumberedSections: false, headings: [], firstChunk: "", lastChunk: "",
      citationCount: 0, avgParagraphLength: 0, language: "en",
      embeddedMetadata: { title: null, author: null, date: null, subject: null, creator: null, pageCount: null },
    },
  };
}