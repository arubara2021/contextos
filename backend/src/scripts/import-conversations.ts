import { Pool } from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import config from "../config";
import logger from "../utils/logger";

interface ImportedMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface ImportedConversation {
  sessionId?: string;
  title?: string;
  messages: ImportedMessage[];
}

interface ImportData {
  conversations?: ImportedConversation[];
  sessions?: ImportedConversation[];
  messages?: ImportedMessage[];
}

interface ImportResult {
  sessionsCreated: number;
  messagesImported: number;
  chunksCreated: number;
  errors: string[];
  durationMs: number;
}

function validateImportData(data: unknown): ImportData | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.conversations)) {
    return { conversations: obj.conversations as ImportedConversation[] };
  }

  if (Array.isArray(obj.sessions)) {
    return { sessions: obj.sessions as ImportedConversation[] };
  }

  if (Array.isArray(obj.messages)) {
    return { messages: obj.messages as ImportedMessage[] };
  }

  return null;
}

function validateConversation(conv: unknown): ImportedConversation | null {
  if (!conv || typeof conv !== "object") return null;

  const obj = conv as Record<string, unknown>;
  if (!Array.isArray(obj.messages)) return null;

  const messages: ImportedMessage[] = [];
  for (const msg of obj.messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (typeof m.role !== "string" || typeof m.content !== "string") continue;

    const validRoles = ["user", "assistant", "system"];
    if (!validRoles.includes(m.role.toLowerCase())) continue;

    messages.push({
      role: m.role.toLowerCase(),
      content: m.content,
      timestamp: typeof m.timestamp === "string" ? m.timestamp : undefined,
    });
  }

  if (messages.length === 0) return null;

  return {
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
    title: typeof obj.title === "string" ? obj.title : undefined,
    messages,
  };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let count = words.length;
  for (const word of words) {
    if (word.length > 6) {
      count += Math.floor(word.length / 4) - 1;
    }
  }
  return count;
}

function splitIntoChunks(text: string, maxTokens: number = 250): string[] {
  const totalTokens = estimateTokens(text);
  if (totalTokens <= maxTokens) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    const currentTokens = estimateTokens(current);
    const paragraphTokens = estimateTokens(paragraph);

    if (paragraphTokens > maxTokens) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      const sentences = paragraph.match(/[^.!?]+[.!?]+[\s]*/g) || [paragraph];
      let sentenceChunk = "";
      for (const sentence of sentences) {
        const chunkTokens = estimateTokens(sentenceChunk);
        const sentenceTokens = estimateTokens(sentence);
        if (chunkTokens + sentenceTokens > maxTokens && sentenceChunk.trim()) {
          chunks.push(sentenceChunk.trim());
          sentenceChunk = sentence;
        } else {
          sentenceChunk += sentence;
        }
      }
      if (sentenceChunk.trim()) chunks.push(sentenceChunk.trim());
      continue;
    }

    if (currentTokens + paragraphTokens > maxTokens && current.trim()) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function importConversations(
  pool: Pool,
  userId: string,
  data: ImportData
): Promise<ImportResult> {
  const start = Date.now();
  let sessionsCreated = 0;
  let messagesImported = 0;
  let chunksCreated = 0;
  const errors: string[] = [];

  const conversations: ImportedConversation[] = [];

  if (data.conversations) {
    for (const conv of data.conversations) {
      const validated = validateConversation(conv);
      if (validated) conversations.push(validated);
    }
  }

  if (data.sessions) {
    for (const session of data.sessions) {
      const validated = validateConversation(session);
      if (validated) conversations.push(validated);
    }
  }

  if (data.messages && data.messages.length > 0) {
    conversations.push({
      title: "Imported conversation",
      messages: data.messages,
    });
  }

  console.log(`Importing ${conversations.length} conversations...\n`);

  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    const sessionId = conv.sessionId ?? uuidv4();
    const title = conv.title ?? `Imported conversation ${i + 1}`;

    try {
      await pool.query(
        `INSERT INTO sessions (session_id, user_id, title, message_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id) DO UPDATE SET
           title = EXCLUDED.title,
           message_count = EXCLUDED.message_count,
           updated_at = now()`,
        [sessionId, userId, title, conv.messages.length]
      );

      sessionsCreated++;
      console.log(`[${i + 1}/${conversations.length}] Session: "${title}"`);

      for (let j = 0; j < conv.messages.length; j++) {
        const msg = conv.messages[j];
        const messageId = uuidv4();
        const timestamp = msg.timestamp ?? new Date(Date.now() + j * 60000).toISOString();

        try {
          await pool.query(
            `INSERT INTO messages (message_id, session_id, role, content, timestamp)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [messageId, sessionId, msg.role, msg.content, timestamp]
          );

          messagesImported++;

          const chunks = splitIntoChunks(msg.content);
          for (let k = 0; k < chunks.length; k++) {
            const chunkId = uuidv4();
            try {
              await pool.query(
                `INSERT INTO raw_chunks (chunk_id, message_id, text, metadata)
                 VALUES ($1, $2, $3, $4)`,
                [
                  chunkId,
                  messageId,
                  chunks[k],
                  JSON.stringify({
                    role: msg.role,
                    sessionId,
                    timestamp,
                    chunkIndex: k,
                    tokenEstimate: estimateTokens(chunks[k]),
                  }),
                ]
              );
              chunksCreated++;
            } catch (chunkError) {
              errors.push(
                `Chunk creation failed for message ${j + 1} in session "${title}": ${(chunkError as Error).message}`
              );
            }
          }

          if ((j + 1) % 5 === 0) {
            console.log(`  Messages: ${j + 1}/${conv.messages.length}`);
          }
        } catch (msgError) {
          errors.push(
            `Message ${j + 1} in session "${title}" failed: ${(msgError as Error).message}`
          );
        }
      }

      console.log(`  ✓ ${conv.messages.length} messages imported`);
    } catch (sessionError) {
      errors.push(
        `Session "${title}" creation failed: ${(sessionError as Error).message}`
      );
    }
  }

  const durationMs = Date.now() - start;

  return {
    sessionsCreated,
    messagesImported,
    chunksCreated,
    errors,
    durationMs,
  };
}

async function main(): Promise<void> {
  console.log("ContextOS Conversation Importer");
  console.log("================================\n");

  const args = process.argv.slice(2);
  const filePath = args[0];
  const targetEmail = args[1] ?? "demo@contextos.local";

  if (!filePath) {
    console.error("Usage: ts-node import-conversations.ts <file.json> [user-email]");
    console.error("\nSupported formats:");
    console.error('  {"conversations": [...]}');
    console.error('  {"sessions": [...]}');
    console.error('  {"messages": [...]}');
    process.exit(1);
  }

  const resolvedPath = join(process.cwd(), filePath);
  if (!existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  let rawJson: string;
  try {
    rawJson = readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    console.error(`Failed to read file: ${(error as Error).message}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    console.error(`Invalid JSON: ${(error as Error).message}`);
    process.exit(1);
  }

  const data = validateImportData(parsed);
  if (!data) {
    console.error(
      "Invalid format. Expected {conversations: [...]}, {sessions: [...]}, or {messages: [...]}"
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: config.cockroach.connectionString,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log("Testing connection...");
    await pool.query("SELECT 1");
    console.log("Connection successful\n");

    console.log(`Looking up user: ${targetEmail}`);
    const userResult = await pool.query(
      "SELECT user_id FROM users WHERE email = $1",
      [targetEmail.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      console.error(`User not found: ${targetEmail}`);
      console.error("Run seed-demo.ts first or register a user.");
      process.exit(1);
    }

    const userId = userResult.rows[0].user_id;
    console.log(`User found: ${userId}\n`);

    const result = await importConversations(pool, userId, data);

    console.log("\n================================");
    console.log("Import complete:");
    console.log(`  Sessions created: ${result.sessionsCreated}`);
    console.log(`  Messages imported: ${result.messagesImported}`);
    console.log(`  Chunks created: ${result.chunksCreated}`);
    console.log(`  Duration: ${result.durationMs}ms`);

    if (result.errors.length > 0) {
      console.warn(`\nErrors (${result.errors.length}):`);
      for (const error of result.errors) {
        console.warn(`  - ${error}`);
      }
    }

    if (result.sessionsCreated > 0) {
      console.log("\nRun the ingestion pipeline to extract concepts:");
      console.log("  npm run reprocess");
    }
  } catch (error) {
    console.error("\nImport failed:");
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();