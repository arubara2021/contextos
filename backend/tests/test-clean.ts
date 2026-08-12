import * as fs from "fs";
import * as path from "path";
import { detectFormat } from "../src/ingestion/format-detector";
import { parseDocument } from "../src/ingestion/parsers/index";
import { classifyField } from "../src/ingestion/field-classifier";
import { runMetadataGate } from "../src/ingestion/metadata-gate";
import { processDocumentFast } from "../src/ingestion/fast-processor";
import { getDomainProfile } from "../src/ingestion/domain-profiles/index";

const FILE_PATH = process.argv[2];

if (!FILE_PATH) {
  console.log("Usage: npx ts-node tests/test-clean.ts <path-to-file>");
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.log(`File not found: ${FILE_PATH}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(FILE_PATH);
  const filename = path.basename(FILE_PATH);
  const sizeKB = (buffer.length / 1024).toFixed(1);

  console.log(`\n  File: ${filename} (${sizeKB} KB)\n`);

  const detection = detectFormat(filename, buffer);
  const parsed = await parseDocument(detection.format, buffer, filename);
  const classification = classifyField(parsed.structure, detection.format);
  const gateResult = await runMetadataGate(
    { filename, buffer, mimeType: undefined },
    { allowAiFallback: false }
  );
  const profile = getDomainProfile(gateResult.domain);
  const result = processDocumentFast(gateResult);

  const allKeywords = result.chunks.flatMap((c: any) => c.keywords);

  const seen = new Set<string>();
  const uniqueKeywords = allKeywords.filter((kw: any) => {
    const key = kw.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const importantKeywords = uniqueKeywords
    .filter((kw: any) => {
      if (kw.importance < 4) return false;
      if (/^\d/.test(kw.label)) return false;
      if (/^[a-z]\.\s/i.test(kw.label)) return false;
      if (/^[A-Z]\.\s+[A-Z][a-z]/.test(kw.label)) return false;
      if (kw.label.length < 4) return false;
      if (kw.definition.startsWith("Concept:")) return false;
      return true;
    })
    .sort((a: any, b: any) => b.importance - a.importance)
    .slice(0, 20);

  const sections = [...new Set(result.chunks.map((c: any) => c.section).filter(Boolean))];

  console.log("  ── Document ──────────────────────────────────");
  console.log(`  Title:      ${gateResult.extractedTitle || parsed.structure.embeddedMetadata.title || filename}`);
  console.log(`  Type:       ${gateResult.fieldType}`);
  console.log(`  Domain:     ${gateResult.domain}`);
  console.log(`  Confidence: ${gateResult.confidence}`);
  console.log(`  Words:      ${gateResult.wordCount.toLocaleString()}`);
  console.log(`  Pages:      ${gateResult.pageCount || "N/A"}`);
  console.log(`  Sections:   ${sections.length}`);

  console.log("\n  ── Sections ──────────────────────────────────");
  for (const s of sections) {
    const sectionChunks = result.chunks.filter((c: any) => c.section === s);
    const sectionTokens = sectionChunks.reduce((sum: number, c: any) => sum + c.tokenEstimate, 0);
    console.log(`  ${s} (${sectionChunks.length} chunks, ~${sectionTokens} tokens)`);
  }

  console.log("\n  ── Key Concepts ──────────────────────────────");
  if (importantKeywords.length === 0) {
    console.log("  (no significant concepts extracted)");
  } else {
    for (let i = 0; i < importantKeywords.length; i++) {
      const kw = importantKeywords[i];
      const def = kw.definition.length > 100
        ? kw.definition.substring(0, 97) + "..."
        : kw.definition;
      console.log(`  ${String(i + 1).padStart(2)}. ${kw.label}`);
      console.log(`      ${def}`);
    }
  }

  console.log("\n  ── Stats ─────────────────────────────────────");
  console.log(`  Chunks:              ${result.chunks.length}`);
  console.log(`  Raw keywords:        ${allKeywords.length}`);
  console.log(`  Unique keywords:     ${uniqueKeywords.length}`);
  console.log(`  After filtering:     ${importantKeywords.length}`);
  console.log(`  Processing time:     ${result.processingTimeMs}ms`);
  console.log(`  Domain profile:      ${profile.name}`);

  console.log("");
}

main().catch((err: Error) => {
  console.error("Error:", err.message);
  process.exit(1);
});