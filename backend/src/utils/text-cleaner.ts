// FILE: src/utils/text-cleaner.ts

const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB06": "st",
};

const UNICODE_QUOTES: [RegExp, string][] = [
  [/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"'],
  [/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"],
];

const UNICODE_PUNCTUATION: [RegExp, string][] = [
  [/\u2013/g, "-"],
  [/\u2014/g, " -- "],
  [/\u2026/g, "..."],
  [/\u00B7/g, " "],
  [/\u2022/g, " "],
  [/\u2212/g, "-"],
  [/\u00D7/g, "x"],
  [/\u00F7/g, "/"],
  [/\u2264/g, "<="],
  [/\u2265/g, ">="],
  [/\u2260/g, "!="],
  [/\u2248/g, "~"],
  [/\u221E/g, "infinity"],
  [/\u2211/g, "sum"],
  [/\u220F/g, "prod"],
  [/\u222B/g, "integral"],
  [/\u2202/g, "partial"],
  [/\u2207/g, "nabla"],
  [/\u221A/g, "sqrt"],
];

const UNICODE_INVISIBLE: [RegExp, string][] = [
  [/\u00A0/g, " "],
  [/\u00AD/g, ""],
  [/[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, ""],
  [/\u2060/g, ""],
  [/\u180E/g, ""],
];

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

const ENCODING_ARTIFACTS: [RegExp, string][] = [
  [/\u00E2\u0080\u0099/g, "'"],
  [/\u00E2\u0080\u009C/g, '"'],
  [/\u00E2\u0080\u009D/g, '"'],
  [/\u00E2\u0080\u0098/g, "'"],
  [/\u00E2\u0080\u0093/g, "-"],
  [/\u00E2\u0080\u0094/g, " -- "],
  [/\u00E2\u0080\u00A6/g, "..."],
  [/\u00C2\u00A0/g, " "],
  [/\uFFFD/g, ""],
];

const FULLWIDTH_RANGE = /[\uFF01-\uFF5E]/g;

const ENCODING_BYTE_RANGE = /\u00E2\u0080[\u0090-\u009F]/g;
const ENCODING_BYTE_MAP: Record<number, string> = {
  0x90: "-", 0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"',
  0x95: " ", 0x96: "-", 0x97: " -- ", 0x98: "'", 0x99: "'",
  0x9A: " ", 0x9B: ">", 0x9C: "oe", 0x9D: "", 0x9E: "",
  0x9F: "Y",
};

const PAGE_NUMBER_PATTERNS = [
  /^\s*-?\s*\d{1,4}\s*-?\s*$/,
  /^\s*Page\s+\d{1,4}\s*(?:of\s+\d{1,4})?\s*$/,
  /^\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/,
  /^\s*$$\s*\d{1,4}\s*$$\s*$/,
  /^--\s*\d+\s+of\s+\d+\s*--$/,
  /^\d+\s+of\s+\d+$/,
];

const WATERMARK_PATTERNS = [
  /\b(?:DRAFT|CONFIDENTIAL|DO NOT DISTRIBUTE|PREPRINT|WORKING PAPER)\b/i,
  /\b(?:Accepted|Published|Copyright)\s+(?:version|manuscript|article)/i,
  /\b(?:arXiv|bioRxiv|medRxiv|SSRN)\s*:\s*\d+\.\d+/i,
];

const NOISE_LINE_PATTERNS = [
  /^doi:\s*\S+$/im,
  /^https?:\/\/\S+$/im,
  /^downloaded\s+from/im,
  /^published\s+(?:by|online)\s/im,
  /^all\s+rights\s+reserved/im,
  /^this\s+article\s+is\s+(?:published|available|distributed)/im,
  /^received:\s*\d/im,
  /^revised:\s*\d/im,
  /^accepted:\s*\d/im,
  /^published:\s*\d/im,
  /^article\s+history/im,
  /^journal\s+of\s+\w/im,
  /^proceedings\s+of\s+(?:the\s+)?\w/im,
  /^transactions\s+on\s+\w/im,
  /^international\s+journal\s+of/im,
  /^ieee\s+\w/im,
  /^acm\s+\w/im,
  /^springer\b/im,
  /^elsevier\b/im,
  /^wiley\b/im,
  /^\d{1,3}\s*$/,
  /^page\s+\d+/im,
  /^\d+\s+of\s+\d+$/m,
  /^vol(?:\.|ume)\s*\d+/im,
  /^volume\s+\d+[,.]?\s*(?:no|issue|number)/im,
  /^issn\s+[\d-]/im,
  /^isbn\s+[\d-]+$/im,
  /^\*?\s*corresponding?\s+author/im,
  /^e-?mail:\s*\S+@\S+$/im,
  /^[\w.+-]+@[\w-]+\.[\w.]+$/,
  /^\d+\s+(?:department|faculty|school|institute|laboratory|center|centre)\s+of/im,
  /^(?:university|institut[eo]?|college)\s+/im,
  /^preprint\s+/im,
  /^submitted\s+to\s+/im,
  /^accepted\s+by\s+/im,
  /^appears?\s+in\s+/im,
  /^presented\s+at\s+/im,
  /^conference\s+on\s+/im,
  /^symposium\s+on\s+/im,
  /^workshop\s+on\s+/im,
  /^supplementary\s+(?:material|information|data)/im,
  /^appendix\s+[a-z]?\s*$/im,
  /^fig(?:ure)?\.?\s*\d+\s*[:.]?\s*$/im,
  /^table\s+\d+\s*[:.]?\s*$/im,
  /^arXiv:\d+\.\d+/im,
  /^openreview\.net/im,
  /^url\s+https?:/im,
];

const REPEATED_HEADING_PATTERN = /^(?:chapter|section|part|unit)\s+\d+$/i;

// ═══════════════════════════════════════════
//  Main public functions
// ═══════════════════════════════════════════

export function cleanPdfText(text: string): string {
  let result = text;

  result = replaceLigatures(result);
  result = normalizeUnicode(result);
  result = fixEncodingArtifacts(result);
  result = removeControlCharacters(result);
  result = normalizeFullwidth(result);
  result = removeRepeatedLines(result);
  result = removeNoiseLines(result);
  result = dehyphenate(result);
  result = joinBrokenLines(result);
  result = normalizeWhitespace(result);

  return result;
}

export function cleanText(text: string): string {
  let result = text;
  result = replaceLigatures(result);
  result = normalizeUnicode(result);
  result = fixEncodingArtifacts(result);
  result = removeControlCharacters(result);
  result = normalizeWhitespace(result);
  return result;
}

export function cleanWhitespace(text: string): string {
  return normalizeWhitespace(text);
}

export function removePageNumbers(text: string): string {
  return text
    .split("\n")
    .filter((line) => !PAGE_NUMBER_PATTERNS.some((p) => p.test(line.trim())))
    .join("\n");
}

export function removeWatermarks(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length > 80) return true;
      return !WATERMARK_PATTERNS.some((p) => p.test(trimmed));
    })
    .join("\n");
}

// ═══════════════════════════════════════════
//  Unicode normalization
// ═══════════════════════════════════════════

function replaceLigatures(text: string): string {
  let result = text;
  for (const [from, to] of Object.entries(LIGATURES)) {
    if (result.includes(from)) result = result.split(from).join(to);
  }
  return result;
}

function normalizeUnicode(text: string): string {
  let result = text;
  for (const [pattern, replacement] of UNICODE_QUOTES) result = result.replace(pattern, replacement);
  for (const [pattern, replacement] of UNICODE_PUNCTUATION) result = result.replace(pattern, replacement);
  for (const [pattern, replacement] of UNICODE_INVISIBLE) result = result.replace(pattern, replacement);
  return result;
}

function fixEncodingArtifacts(text: string): string {
  let result = text;
  for (const [pattern, replacement] of ENCODING_ARTIFACTS) result = result.replace(pattern, replacement);
  result = result.replace(ENCODING_BYTE_RANGE, (match) => {
    const code = match.charCodeAt(2);
    return ENCODING_BYTE_MAP[code] || "";
  });
  return result;
}

function removeControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}

function normalizeFullwidth(text: string): string {
  return text.replace(FULLWIDTH_RANGE, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
}

// ═══════════════════════════════════════════
//  Line-level cleaning
// ═══════════════════════════════════════════

function removeRepeatedLines(text: string): string {
  const lines = text.split("\n");
  const freq = new Map<string, number>();

  for (const line of lines) {
    const t = line.trim();
    if (t.length >= 3 && t.length <= 120) freq.set(t, (freq.get(t) || 0) + 1);
  }

  const threshold = Math.max(3, Math.floor(lines.length * 0.2));
  const repeated = new Set<string>();
  for (const [line, count] of freq) {
    if (count >= threshold) repeated.add(line);
  }

  if (repeated.size === 0) return text;
  return lines.filter((line) => !repeated.has(line.trim())).join("\n");
}

function removeNoiseLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (t.length === 0) return true;
      if (NOISE_LINE_PATTERNS.some((p) => p.test(t))) return false;

      const numbers = t.match(/\d+\.?\d*/g) || [];
      const words = t.split(/\s+/).filter((w) => w.length > 0);
      if (words.length > 2 && numbers.length / words.length > 0.6) return false;

      return true;
    })
    .join("\n");
}



function dehyphenate(text: string): string {
  return text.replace(/(\w{3,})-\s*\n\s*(\w{2,})/g, (_m, a, b) => a + b);
}

function joinBrokenLines(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trimEnd();
    const next = lines[i + 1];

    if (!next || !next.trim()) {
      result.push(cur);
      continue;
    }

    if (cur.trimStart().startsWith("## ")) {
      result.push(cur);
      continue;
    }
    if (next.trim().startsWith("## ")) {
      result.push(cur);
      continue;
    }

    const nxt = next.trim();
    const prevLine = i > 0 ? lines[i - 1] : "";
    const curTrimmed = cur.trim();

    const looksLikeHeading =
      !prevLine.trim() &&
      curTrimmed.length >= 3 &&
      curTrimmed.length < 80 &&
      /^[A-Z]/.test(curTrimmed) &&
      !/[.;,]$/.test(curTrimmed) &&
      curTrimmed.split(/\s+/).length <= 10 &&
      nxt.length > curTrimmed.length;

    if (looksLikeHeading) {
      result.push(cur);
      continue;
    }

    const shouldJoin =
      cur.length > 0 &&
      nxt.length > 0 &&
      !/[.!?;:\])}"']$/.test(cur) &&
      !/^\d+[.)]\s/.test(nxt) &&
      !/^[A-Z][A-Z\s]{4,}$/.test(nxt) &&
      !/^#{1,6}\s/.test(nxt) &&
      !/^(?:chapter|section|figure|table|abstract|introduction|method|result|discussion|conclusion|references|appendix|acknowledgment)\b/i.test(nxt) &&
      !/^\d+\.\s+[A-Z]/.test(nxt) &&
      !/^[•\-\*]\s/.test(nxt) &&
      !/^$$[a-z]$$\s/.test(nxt) &&
      !REPEATED_HEADING_PATTERN.test(nxt);

    if (shouldJoin) {
      result.push(cur + " " + nxt);
      i++;
    } else {
      result.push(cur);
    }
  }

  return result.join("\n");
}



function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .replace(/\t+/g, " ")
    .trim();
}