// FILE: src/ingestion/parsers/index.ts

import type { FileFormat, ParsedDocument } from "../../types/ingestion.types";
import { parsePdf } from "./pdf-parser";
import { parseDocx } from "./docx-parser";
import { parseMarkdown } from "./markdown-parser";
import { parseText } from "./text-parser";

export type ParserFunction = (
  buffer: Buffer,
  filename: string
) => Promise<ParsedDocument> | ParsedDocument;

export async function parseDocument(
  format: FileFormat,
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  switch (format) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "md":
      return parseMarkdown(buffer);
    case "txt":
    case "json":
    case "csv":
    case "yaml":
    case "html":
    case "code":
      return parseText(buffer, filename, format);
    case "unknown":
      return tryAllParsers(buffer, filename);
    default:
      return parseText(buffer, filename, format);
  }
}

async function tryAllParsers(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  try {
    const pdfResult = await parsePdf(buffer);
    if (pdfResult.text.trim().length > 50) return pdfResult;
  } catch {}

  try {
    const docxResult = await parseDocx(buffer);
    if (docxResult.text.trim().length > 50) return docxResult;
  } catch {}

  try {
    const mdResult = parseMarkdown(buffer);
    if (mdResult.text.trim().length > 50) return mdResult;
  } catch {}

  return parseText(buffer, filename, "unknown");
}

export { parsePdf } from "./pdf-parser";
export { parseDocx } from "./docx-parser";
export { parseMarkdown } from "./markdown-parser";
export { parseText } from "./text-parser";