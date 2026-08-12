import type { AIProvider } from "./ai-provider";
import { getCloudProviderDefinitions } from "./provider-config";
import { GoogleProvider } from "./google-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import type {
  ProviderOrderInfo,
  ProviderRegistryOptions,
} from "../types/ai-providers.types";

function normalizeProviderName(value: string | undefined | null): string {
  const raw = String(value ?? "")
    .toLowerCase()
    .trim();

  if (!raw) return "";

  if (raw === "gemini" || raw === "googleai" || raw === "google-ai") {
    return "google";
  }

  if (raw === "nim" || raw === "nvidia-nim" || raw === "nvidianim") {
    return "nvidia";
  }

  if (raw === "samba" || raw === "samba-nova") {
    return "sambanova";
  }

  return raw;
}

function parseFallbackProviders(raw: string | undefined | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((item) => normalizeProviderName(item))
    .filter((item) => item.length > 0);
}

export function createCloudProviders(): Record<string, AIProvider> {
  const providers: Record<string, AIProvider> = {};

  for (const definition of getCloudProviderDefinitions()) {
    if (definition.name === "google") {
      providers[definition.name] = new GoogleProvider(definition);
      continue;
    }

    providers[definition.name] = new OpenAICompatibleProvider(definition);
  }

  return providers;
}

export function buildProviderRegistry(
  existingProviders?: Record<string, AIProvider>,
  options?: ProviderRegistryOptions
): Record<string, AIProvider> {
  const providers: Record<string, AIProvider> = {
    ...(existingProviders ?? {}),
    ...(options?.existingProviders ?? {}),
  };

  const cloudProviders = createCloudProviders();

  for (const [name, provider] of Object.entries(cloudProviders)) {
    providers[name] = provider;
  }

  return providers;
}

export function getDefaultProvider(
  providers: Record<string, AIProvider>,
  options?: ProviderRegistryOptions
): string | null {
  const available = Object.keys(providers);

  if (available.length === 0) return null;

  const requested = normalizeProviderName(
    options?.defaultProvider ?? process.env.AI_DEFAULT_PROVIDER
  );

  if (requested && providers[requested]) {
    return requested;
  }

  const cloudOrder = getCloudProviderDefinitions().map(
    (definition) => definition.name
  );

  for (const name of cloudOrder) {
    if (providers[name]) return name;
  }

  return available[0] ?? null;
}

export function getProviderOrder(
  providers: Record<string, AIProvider>,
  options?: ProviderRegistryOptions
): string[] {
  const available = Object.keys(providers);

  if (available.length === 0) return [];

  const defaultProvider = getDefaultProvider(providers, options);

  const requestedFallbacks = parseFallbackProviders(
    options?.fallbackProviders?.join(",") ??
      process.env.AI_FALLBACK_PROVIDERS
  );

  const cloudOrder = getCloudProviderDefinitions().map(
    (definition) => definition.name
  );

  const order: string[] = [];
  const seen = new Set<string>();

  const add = (name: string | null | undefined) => {
    const normalized = normalizeProviderName(name);
    if (!normalized) return;
    if (!providers[normalized]) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    order.push(normalized);
  };

  add(defaultProvider);

  for (const name of requestedFallbacks) {
    add(name);
  }

  for (const name of cloudOrder) {
    add(name);
  }

  for (const name of available) {
    add(name);
  }

  return order;
}

export function getProviderOrderInfo(
  providers: Record<string, AIProvider>,
  options?: ProviderRegistryOptions
): ProviderOrderInfo {
  const order = getProviderOrder(providers, options);
  const defaultProvider = getDefaultProvider(providers, options);

  const fallbackProviders = order.filter(
    (name) => name !== defaultProvider
  );

  return {
    defaultProvider,
    fallbackProviders,
    order,
  };
}