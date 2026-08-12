import {
  parseJsonResponse,
  parseJsonArray,
  parseJsonObject,
  parseJsonWithFallback,
  isValidJson,
  safeStringify,
  extractJsonFromMarkdown,
  parseJsonResponseRobust,
} from "../../src/utils/json-parser";

describe("parseJsonResponse", () => {
  it("parses valid JSON object", () => {
    const result = parseJsonResponse<{ name: string }>(
      '{"name": "test"}'
    );
    expect(result).toEqual({ name: "test" });
  });

  it("parses valid JSON array", () => {
    const result = parseJsonResponse<number[]>("[1, 2, 3]");
    expect(result).toEqual([1, 2, 3]);
  });

  it("returns null for empty string", () => {
    expect(parseJsonResponse("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseJsonResponse("   ")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseJsonResponse(null as any)).toBeNull();
  });

  it("uses fallback value when parse fails", () => {
    const result = parseJsonResponse("not json", {
      fallbackValue: { default: true },
    });
    expect(result).toEqual({ default: true });
  });

  it("returns null when parse fails and no fallback", () => {
    expect(parseJsonResponse("not json")).toBeNull();
  });

  it("extracts JSON object from surrounding text", () => {
    const text = 'Here is the result: {"key": "value"} end of text';
    const result = parseJsonResponse<{ key: string }>(text);
    expect(result).toEqual({ key: "value" });
  });

  it("extracts JSON array from surrounding text", () => {
    const text = "Results: [1, 2, 3] done";
    const result = parseJsonResponse<number[]>(text);
    expect(result).toEqual([1, 2, 3]);
  });

  it("extracts multiple JSON objects", () => {
    const text = '{"a": 1} some text {"b": 2}';
    const result = parseJsonResponse<Array<{ a?: number; b?: number }>>(
      text
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("parses JSON lines format", () => {
    const text = '{"a": 1}\n{"b": 2}\n{"c": 3}';
    const result = parseJsonResponse<Array<Record<string, number>>>(text);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result.length).toBe(3);
    }
  });

  it("cleans markdown code fences", () => {
    const text = '```json\n{"key": "value"}\n```';
    const result = parseJsonResponse<{ key: string }>(text);
    expect(result).toEqual({ key: "value" });
  });

  it("cleans trailing commas", () => {
    const text = '{"a": 1, "b": 2,}';
    const result = parseJsonResponse<{ a: number; b: number }>(text);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("handles nested objects", () => {
    const obj = { level1: { level2: { level3: "deep" } } };
    const result = parseJsonResponse<typeof obj>(JSON.stringify(obj));
    expect(result).toEqual(obj);
  });

  it("handles arrays of objects", () => {
    const arr = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const result = parseJsonResponse<typeof arr>(JSON.stringify(arr));
    expect(result).toEqual(arr);
  });

  it("handles null as valid JSON", () => {
    const result = parseJsonResponse("null");
    expect(result).toBeNull();
  });

  it("handles boolean as valid JSON", () => {
    expect(parseJsonResponse("true")).toBe(true);
    expect(parseJsonResponse("false")).toBe(false);
  });

  it("handles number as valid JSON", () => {
    expect(parseJsonResponse("42")).toBe(42);
    expect(parseJsonResponse("3.14")).toBe(3.14);
  });
});

describe("parseJsonArray", () => {
  it("parses a JSON array", () => {
    const result = parseJsonArray<string>('["a", "b", "c"]');
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("wraps non-array result in array", () => {
    const result = parseJsonArray<{ key: string }>('{"key": "value"}');
    expect(result).toEqual([{ key: "value" }]);
  });

  it("returns empty array for null input", () => {
    expect(parseJsonArray("")).toEqual([]);
  });

  it("returns empty array for unparseable input", () => {
    expect(parseJsonArray("not json")).toEqual([]);
  });

  it("extracts array from surrounding text", () => {
    const text = "Here are items: [1, 2, 3] that is all";
    const result = parseJsonArray<number>(text);
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("parseJsonObject", () => {
  it("parses a JSON object", () => {
    const result = parseJsonObject<{ a: number }>('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it("returns null for arrays", () => {
    const result = parseJsonObject("[1, 2, 3]");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseJsonObject("")).toBeNull();
  });

  it("returns null for non-object parse result", () => {
    expect(parseJsonObject("42")).toBeNull();
    expect(parseJsonObject("true")).toBeNull();
  });

  it("extracts object from surrounding text", () => {
    const text = 'The result is {"name": "test"} from the system';
    const result = parseJsonObject<{ name: string }>(text);
    expect(result).toEqual({ name: "test" });
  });
});

describe("parseJsonWithFallback", () => {
  it("returns parsed result when valid", () => {
    const result = parseJsonWithFallback<{ a: number }>(
      '{"a": 1}',
      { a: 0 }
    );
    expect(result).toEqual({ a: 1 });
  });

  it("returns fallback for invalid JSON", () => {
    const fallback = { a: 0, b: "default" };
    const result = parseJsonWithFallback("not json", fallback);
    expect(result).toEqual(fallback);
  });

  it("returns fallback for empty string", () => {
    const result = parseJsonWithFallback("", []);
    expect(result).toEqual([]);
  });
});

describe("isValidJson", () => {
  it("returns true for valid JSON object", () => {
    expect(isValidJson('{"key": "value"}')).toBe(true);
  });

  it("returns true for valid JSON array", () => {
    expect(isValidJson("[1, 2, 3]")).toBe(true);
  });

  it("returns true for JSON primitives", () => {
    expect(isValidJson("42")).toBe(true);
    expect(isValidJson('"hello"')).toBe(true);
    expect(isValidJson("true")).toBe(true);
    expect(isValidJson("null")).toBe(true);
  });

  it("returns false for invalid JSON", () => {
    expect(isValidJson("not json")).toBe(false);
    expect(isValidJson("{key: value}")).toBe(false);
    expect(isValidJson("undefined")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidJson("")).toBe(false);
  });

  it("returns false for trailing comma", () => {
    expect(isValidJson('{"a": 1,}')).toBe(false);
  });
});

describe("safeStringify", () => {
  it("stringifies a simple object", () => {
    const result = safeStringify({ a: 1, b: "two" });
    expect(JSON.parse(result)).toEqual({ a: 1, b: "two" });
  });

  it("handles circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;

    const result = safeStringify(obj);
    const parsed = JSON.parse(result);

    expect(parsed.a).toBe(1);
    expect(parsed.self).toBe("[Circular]");
  });

  it("handles BigInt values", () => {
    const obj = { big: BigInt(9007199254740993) };

    const result = safeStringify(obj);
    const parsed = JSON.parse(result);

    expect(typeof parsed.big).toBe("string");
  });

  it("handles Date objects", () => {
    const date = new Date("2024-01-01T00:00:00Z");
    const obj = { created: date };

    const result = safeStringify(obj);
    const parsed = JSON.parse(result);

    expect(parsed.created).toBe("2024-01-01T00:00:00.000Z");
  });

  it("handles Error objects", () => {
    const obj = { err: new Error("test error") };

    const result = safeStringify(obj);
    const parsed = JSON.parse(result);

    expect(parsed.err.message).toBe("test error");
    expect(parsed.err.name).toBe("Error");
  });

  it("handles undefined values by converting to null", () => {
    const obj = { a: undefined, b: 1 };

    const result = safeStringify(obj);
    const parsed = JSON.parse(result);

    expect(parsed.a).toBeNull();
    expect(parsed.b).toBe(1);
  });

  it("respects space parameter", () => {
    const result = safeStringify({ a: 1 }, 2);

    expect(result).toContain("\n");
    expect(result).toContain("  ");
  });

  it("handles deeply nested circular reference", () => {
    const obj: any = { level1: { level2: {} } };
    obj.level1.level2.back = obj;

    const result = safeStringify(obj);
    const parsed = JSON.parse(result);

    expect(parsed.level1.level2.back).toBe("[Circular]");
  });

  it("handles array with circular reference", () => {
    const arr: any[] = [1, 2];
    arr.push(arr);

    const result = safeStringify(arr);
    const parsed = JSON.parse(result);

    expect(parsed[0]).toBe(1);
    expect(parsed[1]).toBe(2);
    expect(parsed[2]).toBe("[Circular]");
  });
});

describe("extractJsonFromMarkdown", () => {
  it("extracts JSON from code block", () => {
    const text = '```json\n{"key": "value"}\n```';
    const result = extractJsonFromMarkdown(text);
    expect(result).toBe('{"key": "value"}');
  });

  it("extracts JSON from code block without language tag", () => {
    const text = '```\n{"key": "value"}\n```';
    const result = extractJsonFromMarkdown(text);
    expect(result).toBe('{"key": "value"}');
  });

  it("extracts inline JSON", () => {
    const text = 'The result is `{"key": "value"}` from the API';
    const result = extractJsonFromMarkdown(text);
    expect(result).toBe('{"key": "value"}');
  });

  it("returns null when no JSON found", () => {
    const result = extractJsonFromMarkdown("No JSON here");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractJsonFromMarkdown("")).toBeNull();
  });

  it("extracts first code block when multiple exist", () => {
    const text =
      '```json\n{"first": true}\n```\n\nSome text\n\n```json\n{"second": true}\n```';
    const result = extractJsonFromMarkdown(text);
    expect(result).toBe('{"first": true}');
  });

  it("handles multiline JSON in code block", () => {
    const json = JSON.stringify({ a: 1, b: [2, 3], c: { d: 4 } }, null, 2);
    const text = "```json\n" + json + "\n```";
    const result = extractJsonFromMarkdown(text);
    expect(result).toBe(json);
  });
});

describe("parseJsonResponseRobust", () => {
  it("uses strict strategy for valid JSON", () => {
    const result = parseJsonResponseRobust<{ a: number }>('{"a": 1}');

    expect(result.data).toEqual({ a: 1 });
    expect(result.strategy).toBe("strict");
    expect(result.cleaned).toBe(false);
  });

  it("uses extract_array strategy for array in text", () => {
    const result = parseJsonResponseRobust<number[]>(
      "Here are numbers: [1, 2, 3] done"
    );

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.strategy).toBe("extract_array");
    expect(result.cleaned).toBe(true);
  });

  it("uses extract_object strategy for object in text", () => {
    const result = parseJsonResponseRobust<{ key: string }>(
      'The result: {"key": "value"} is ready'
    );

    expect(result.data).toEqual({ key: "value" });
    expect(result.strategy).toBe("extract_object");
    expect(result.cleaned).toBe(true);
  });

  it("uses markdown_extract strategy for code fences", () => {
    const result = parseJsonResponseRobust<{ a: number }>(
      '```json\n{"a": 1}\n```'
    );

    expect(result.data).toEqual({ a: 1 });
    expect(result.cleaned).toBe(true);
  });

  it("returns null data for completely unparseable input", () => {
    const result = parseJsonResponseRobust("this is not json at all");

    expect(result.data).toBeNull();
    expect(result.strategy).toBe("none");
    expect(result.cleaned).toBe(false);
  });

  it("returns null data for empty string", () => {
    const result = parseJsonResponseRobust("");

    expect(result.data).toBeNull();
  });

  it("handles clean_and_retry with trailing commas", () => {
    const result = parseJsonResponseRobust<{ a: number; b: number }>(
      '{"a": 1, "b": 2,}'
    );

    expect(result.data).toEqual({ a: 1, b: 2 });
  });

  it("reports cleaned flag correctly", () => {
    const strict = parseJsonResponseRobust('{"a": 1}');
    expect(strict.cleaned).toBe(false);

    const extracted = parseJsonResponseRobust("text [1,2,3] text");
    expect(extracted.cleaned).toBe(true);
  });
});