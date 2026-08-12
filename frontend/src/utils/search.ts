export function normalizeTerm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(query: string): string[] {
  return normalizeTerm(query)
    .split(" ")
    .filter((token) => token.length > 0);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scoreMatch(text: string, tokens: string[]): number {
  const haystack = normalizeTerm(text);
  if (!haystack) return 0;
  let score = 0;
  for (const token of tokens) {
    if (haystack === token) score += 6;
    else if (haystack.startsWith(token)) score += 4;
    else if (haystack.includes(token)) score += 2;
    else return 0;
  }
  return score;
}

export function matchesQuery(text: string, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  return scoreMatch(text, tokens) > 0;
}

export function searchItems<T>(
  items: T[],
  query: string,
  fields: Array<(item: T) => string | null | undefined>
): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return items;
  return items
    .map((item) => {
      let best = 0;
      for (const field of fields) {
        const value = field(item);
        if (!value) continue;
        const score = scoreMatch(value, tokens);
        if (score > best) best = score;
      }
      return { item, score: best };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}