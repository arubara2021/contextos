import "dotenv/config";
import {
  buildProviderRegistry,
  getProviderOrder,
} from "../src/agent/provider-registry";
import { checkProviderHealth } from "../src/agent/provider-health";
import type { AIProvider } from "../src/agent/ai-provider";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

function warn(message: string): void {
  console.log(`WARN: ${message}`);
}

async function testChat(provider: AIProvider, name: string): Promise<void> {
  const result = await provider.chat({
    systemPrompt: "You are a health check assistant.",
    userMessage: "Reply with ok",
    maxTokens: 16,
    temperature: 0,
  });

  assert(
    typeof result.text === "string" && result.text.trim().length > 0,
    `${name} chat returns non-empty text`
  );
}

async function testStructured(provider: AIProvider, name: string): Promise<void> {
  const systemPrompt = [
    "You are a strict knowledge extraction system.",
    "Extract concepts from the user text.",
    "Output ONLY valid JSON.",
    'Use this format: {"concepts":[{"label":"string","definition":"string","type":"fact","importance":8,"related":[]}]}'
  ].join("\n");

  const userMessage = [
    "Apollo Caching Decision: The team decided to replace the monolithic cache with a partitioned LRU cache.",
    "Repeated Read Problem: Repeated reads from the primary database caused p99 latency spikes."
  ].join("\n");

  const parsed = await provider.structured<any>({
    systemPrompt,
    userMessage,
    maxTokens: 1024,
    temperature: 0.1,
  });

  const concepts = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.concepts)
    ? parsed.concepts
    : [];

  assert(concepts.length >= 1, `${name} structured extraction returns concepts`);

  const first = concepts[0];

  assert(
    first && typeof first.label === "string" && first.label.trim().length > 0,
    `${name} structured extraction returns valid concept label`
  );

  assert(
    first && typeof first.definition === "string" && first.definition.trim().length > 0,
    `${name} structured extraction returns valid concept definition`
  );
}

async function testEmbedding(provider: AIProvider, name: string): Promise<void> {
  const result = await provider.embed({
    text: "ContextOS provider acceptance embedding check",
  });

  assert(
    Array.isArray(result.vector) && result.vector.length > 0,
    `${name} embedding returns vector`
  );
}

async function main(): Promise<void> {
  console.log("ContextOS AI Providers Acceptance Test");
  console.log("");

  const providers = buildProviderRegistry();
  const order = getProviderOrder(providers);

  console.log(`Enabled provider order: ${order.join(", ") || "none"}`);

  if (order.length === 0) {
    console.log("SKIP: No cloud provider API keys are configured.");
    console.log("Set GOOGLE_API_KEY, GROQ_API_KEY, SAMBANOVA_API_KEY, MISTRAL_API_KEY, or NVIDIA_NIM_API_KEY.");
    process.exit(0);
  }

  const health = await checkProviderHealth(providers, {
    names: order,
    timeoutMs: 45000,
  });

  for (const entry of health.entries) {
    if (entry.healthy) {
      console.log(
        `PASS: ${entry.name} healthy in ${entry.latencyMs}ms${
          entry.modelUsed ? ` using ${entry.modelUsed}` : ""
        }`
      );
    } else {
      warn(`${entry.name} unhealthy: ${entry.error ?? "unknown error"}`);
    }
  }

  assert(health.healthy > 0, "At least one cloud provider is healthy");

  const healthyOrder = order.filter((name) =>
    health.entries.some((entry) => entry.name === name && entry.healthy)
  );

  const primaryName = healthyOrder[0];
  const primary = providers[primaryName];

  assert(Boolean(primary), `Primary provider ${primaryName} exists`);

  console.log("");
  console.log(`Testing chat on primary provider: ${primaryName}`);
  await testChat(primary, primaryName);

  console.log("");
  console.log(`Testing structured extraction on primary provider: ${primaryName}`);
  await testStructured(primary, primaryName);

  console.log("");

  const embeddingProviderName = order.find((name) =>
    providers[name].supportsTask("embedding")
  );

  if (!embeddingProviderName) {
    console.log("No embedding provider enabled. Skipping embedding test.");
  } else {
    console.log(`Testing embedding provider: ${embeddingProviderName}`);

    try {
      await testEmbedding(providers[embeddingProviderName], embeddingProviderName);
    } catch (error) {
      warn(
        `${embeddingProviderName} embedding failed: ${(error as Error).message}`
      );
    }
  }

  console.log("");
  console.log("AI PROVIDER TESTS PASSED");
}

main().catch((error) => {
  console.error("");
  console.error("TEST FAILED");
  console.error((error as Error).message);
  process.exit(1);
});