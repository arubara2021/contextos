import fs from "fs";

async function main() {
  const inputPath = process.argv[2];
  const sessionId = process.argv[3] || "doc-session-001";

  if (!inputPath) {
    console.log("Usage: npx ts-node src/scripts/ingest-pdf.ts <path-to-file> [session-id]");
    process.exit(1);
  }

  const rawText = fs.readFileSync(inputPath, "utf-8");
  const BASE = "http://localhost:3001/api";

  async function api(method: string, endpoint: string, body?: any, token?: string): Promise<any> {
    const headers: any = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json() as any;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  console.log(`\n========== DOCUMENT INGESTION ==========\n`);
  console.log(`File: ${inputPath}`);
  console.log(`Characters: ${rawText.length}`);
  console.log(`Words: ${rawText.split(/\s+/).length}\n`);

  // Login
  console.log("[1/3] Logging in...");
  const loginData = await api("POST", "/users/login", {
    email: "test@example.com",
    password: "SecurePass123",
  });
  const token = loginData.token;
  console.log("  OK\n");

  // Create session
  console.log("[2/3] Creating session...");
  const sessionData = await api("POST", "/sessions", { title: "Document Upload" }, token);
  const sid = sessionData.sessionId;
  console.log(`  Session: ${sid}\n`);

  // Chunk and ingest
  console.log("[3/3] Ingesting chunks...\n");

  const chunkSize = 1500;
  const overlap = 200;
  const chunks: string[] = [];

  for (let i = 0; i < rawText.length; i += chunkSize - overlap) {
    const chunk = rawText.substring(i, i + chunkSize).trim();
    if (chunk.length > 30) chunks.push(chunk);
  }

  console.log(`  Chunks: ${chunks.length}\n`);

  for (let i = 0; i < chunks.length; i++) {
    const start = Date.now();
    console.log(`  [${i + 1}/${chunks.length}] Processing (${chunks[i].length} chars)...`);

    try {
      const result = await api("POST", "/chat", {
        message: chunks[i],
        sessionId: sid,
      }, token);

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`    Done in ${elapsed}s`);
      console.log(`    Response: ${(result.response || "").substring(0, 150)}...\n`);
    } catch (error) {
      console.log(`    FAILED: ${(error as Error).message}\n`);
    }
  }

  // Query
  console.log("\n========== QUERYING MEMORY ==========\n");

  const questions = [
    "What is this document about?",
    "What are the main topics discussed?",
  ];

  for (const q of questions) {
    console.log(`Q: ${q}`);
    try {
      const result = await api("POST", "/chat", { message: q, sessionId: sid }, token);
      console.log(`A: ${result.response}\n`);
      console.log("  " + "=".repeat(60) + "\n");
    } catch (error) {
      console.log(`  ERROR: ${(error as Error).message}\n`);
    }
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});