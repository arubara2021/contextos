import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
  vectorMagnitude,
  addVectors,
  subtractVectors,
  scaleVector,
  averageVectors,
  weightedAverageVectors,
  isZeroVector,
  isValidVector,
  vectorDimension,
  clampVector,
  lerpVectors,
  softmax,
  rankByScore,
  manhattanDistance,
} from "../../src/utils/vector-math";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBe(1);
  });

  it("returns 1 for identical non-unit vectors", () => {
    const a = [3, 4, 0];
    const b = [3, 4, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
  });

  it("returns value between -1 and 1 for arbitrary vectors", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [5, 4, 3, 2, 1];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1);
    expect(sim).toBeLessThanOrEqual(1);
    expect(sim).toBeCloseTo(7 / 11, 3);
  });

  it("returns 0 for mismatched dimensions", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for null input", () => {
    expect(cosineSimilarity(null as any, [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], null as any)).toBe(0);
  });

  it("returns 0 for undefined input", () => {
    expect(cosineSimilarity(undefined as any, [1])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("handles non-finite values by skipping them", () => {
    const a = [1, NaN, 3];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("handles Infinity values", () => {
    const a = [1, Infinity, 3];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("works with high-dimensional vectors", () => {
    const dim = 1536;
    const a = Array(dim).fill(0).map((_, i) => Math.sin(i));
    const b = Array(dim).fill(0).map((_, i) => Math.cos(i));
    const result = cosineSimilarity(a, b);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("is symmetric", () => {
    const a = [1, 2, 3, 4];
    const b = [4, 3, 2, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

describe("euclideanDistance", () => {
  it("returns 0 for identical vectors", () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it("computes correct distance", () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBeCloseTo(5, 10);
  });

  it("returns correct distance for unit vectors", () => {
    expect(euclideanDistance([0, 0], [1, 0])).toBe(1);
    expect(euclideanDistance([0, 0], [0, 1])).toBe(1);
  });

  it("is symmetric", () => {
    const a = [1, 5, 9];
    const b = [2, 3, 7];
    expect(euclideanDistance(a, b)).toBeCloseTo(euclideanDistance(b, a), 10);
  });

  it("returns Infinity for mismatched dimensions", () => {
    expect(euclideanDistance([1, 2, 3], [1, 2])).toBe(Infinity);
  });

  it("returns Infinity for null input", () => {
    expect(euclideanDistance(null as any, [1])).toBe(Infinity);
    expect(euclideanDistance([1], null as any)).toBe(Infinity);
  });

  it("returns 0 for empty vectors", () => {
    expect(euclideanDistance([], [])).toBe(0);
  });

  it("handles negative values", () => {
    expect(euclideanDistance([-1, -2], [1, 2])).toBeCloseTo(
      Math.sqrt(4 + 16),
      5
    );
    expect(euclideanDistance([-1, 0], [1, 0])).toBeCloseTo(2, 10);
  });
});

describe("dotProduct", () => {
  it("computes correct dot product", () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(dotProduct([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("returns sum of squares for self dot product", () => {
    const v = [3, 4];
    expect(dotProduct(v, v)).toBe(25);
  });

  it("returns 0 for mismatched dimensions", () => {
    expect(dotProduct([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(dotProduct([], [])).toBe(0);
  });

  it("returns 0 for null input", () => {
    expect(dotProduct(null as any, [1])).toBe(0);
    expect(dotProduct([1], null as any)).toBe(0);
  });

  it("handles negative values", () => {
    expect(dotProduct([-1, 2], [3, -4])).toBe(-11);
  });

  it("is commutative", () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    expect(dotProduct(a, b)).toBe(dotProduct(b, a));
  });
});

describe("normalizeVector", () => {
  it("normalizes a vector to unit length", () => {
    const result = normalizeVector([3, 4]);
    expect(result[0]).toBeCloseTo(0.6, 10);
    expect(result[1]).toBeCloseTo(0.8, 10);
  });

  it("returns same vector for unit vector", () => {
    const result = normalizeVector([1, 0, 0]);
    expect(result[0]).toBeCloseTo(1, 10);
    expect(result[1]).toBeCloseTo(0, 10);
    expect(result[2]).toBeCloseTo(0, 10);
  });

  it("returns zero vector for zero input", () => {
    const result = normalizeVector([0, 0, 0]);
    expect(result).toEqual([0, 0, 0]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeVector([])).toEqual([]);
  });

  it("returns empty array for null input", () => {
    expect(normalizeVector(null as any)).toEqual([]);
  });

  it("preserves direction", () => {
    const result = normalizeVector([2, 4, 6]);
    expect(result[0] / result[1]).toBeCloseTo(2 / 4, 10);
    expect(result[1] / result[2]).toBeCloseTo(4 / 6, 10);
  });

  it("produces unit magnitude", () => {
    const result = normalizeVector([5, 12, -3]);
    const mag = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 10);
  });
});

describe("vectorMagnitude", () => {
  it("returns correct magnitude", () => {
    expect(vectorMagnitude([3, 4])).toBeCloseTo(5, 10);
  });

  it("returns 1 for unit vector", () => {
    expect(vectorMagnitude([1, 0, 0])).toBe(1);
  });

  it("returns 0 for zero vector", () => {
    expect(vectorMagnitude([0, 0, 0])).toBe(0);
  });

  it("returns 0 for empty vector", () => {
    expect(vectorMagnitude([])).toBe(0);
  });

  it("returns 0 for null input", () => {
    expect(vectorMagnitude(null as any)).toBe(0);
  });

  it("handles negative values", () => {
    expect(vectorMagnitude([-3, 4])).toBeCloseTo(5, 10);
  });
});

describe("addVectors", () => {
  it("adds vectors element-wise", () => {
    expect(addVectors([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
  });

  it("handles negative values", () => {
    expect(addVectors([1, -2], [-1, 2])).toEqual([0, 0]);
  });

  it("returns empty for mismatched dimensions", () => {
    expect(addVectors([1, 2], [1, 2, 3])).toEqual([]);
  });

  it("returns empty for null input", () => {
    expect(addVectors(null as any, [1])).toEqual([]);
    expect(addVectors([1], null as any)).toEqual([]);
  });

  it("returns empty for empty vectors", () => {
    expect(addVectors([], [])).toEqual([]);
  });
});

describe("subtractVectors", () => {
  it("subtracts vectors element-wise", () => {
    expect(subtractVectors([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6]);
  });

  it("handles negative result", () => {
    expect(subtractVectors([1, 2], [3, 4])).toEqual([-2, -2]);
  });

  it("returns empty for mismatched dimensions", () => {
    expect(subtractVectors([1, 2], [1])).toEqual([]);
  });

  it("returns empty for null input", () => {
    expect(subtractVectors(null as any, [1])).toEqual([]);
  });
});

describe("scaleVector", () => {
  it("scales vector by scalar", () => {
    expect(scaleVector([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it("handles zero scalar", () => {
    expect(scaleVector([1, 2, 3], 0)).toEqual([0, 0, 0]);
  });

  it("handles negative scalar", () => {
    expect(scaleVector([1, -2, 3], -1)).toEqual([-1, 2, -3]);
  });

  it("returns empty for null input", () => {
    expect(scaleVector(null as any, 2)).toEqual([]);
  });

  it("returns empty for empty vector", () => {
    expect(scaleVector([], 2)).toEqual([]);
  });
});

describe("averageVectors", () => {
  it("averages multiple vectors", () => {
    const result = averageVectors([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(result).toEqual([4, 5, 6]);
  });

  it("returns same vector for single input", () => {
    expect(averageVectors([[3, 4, 5]])).toEqual([3, 4, 5]);
  });

  it("returns empty for empty input", () => {
    expect(averageVectors([])).toEqual([]);
  });

  it("returns empty for null input", () => {
    expect(averageVectors(null as any)).toEqual([]);
  });

  it("skips vectors with mismatched dimensions", () => {
    const result = averageVectors([
      [1, 2, 3],
      [4, 5],
      [7, 8, 9],
    ]);
    expect(result).toEqual([4, 5, 6]);
  });

  it("handles non-finite values by skipping them", () => {
    const result = averageVectors([
      [1, 2, 3],
      [NaN, 5, Infinity],
    ]);
    expect(result).toBeDefined();
    expect(result.length).toBe(3);
  });
});

describe("weightedAverageVectors", () => {
  it("computes weighted average", () => {
    const result = weightedAverageVectors(
      [
        [1, 0],
        [0, 1],
      ],
      [3, 1]
    );
    expect(result[0]).toBeCloseTo(0.75, 10);
    expect(result[1]).toBeCloseTo(0.25, 10);
  });

  it("returns same as average for equal weights", () => {
    const vectors = [
      [2, 4],
      [6, 8],
    ];
    const weighted = weightedAverageVectors(vectors, [1, 1]);
    const averaged = averageVectors(vectors);
    expect(weighted[0]).toBeCloseTo(averaged[0], 10);
    expect(weighted[1]).toBeCloseTo(averaged[1], 10);
  });

  it("returns empty for empty input", () => {
    expect(weightedAverageVectors([], [])).toEqual([]);
  });

  it("returns empty for mismatched lengths", () => {
    expect(
      weightedAverageVectors([[1, 2]], [1, 2])
    ).toEqual([]);
  });

  it("ignores zero-weight vectors", () => {
    const result = weightedAverageVectors(
      [
        [10, 20],
        [1, 2],
      ],
      [1, 0]
    );
    expect(result).toEqual([10, 20]);
  });

  it("returns empty for null input", () => {
    expect(weightedAverageVectors(null as any, [])).toEqual([]);
  });
});

describe("isZeroVector", () => {
  it("returns true for zero vector", () => {
    expect(isZeroVector([0, 0, 0])).toBe(true);
  });

  it("returns false for non-zero vector", () => {
    expect(isZeroVector([0, 1, 0])).toBe(false);
  });

  it("returns true for empty vector", () => {
    expect(isZeroVector([])).toBe(true);
  });

  it("returns true for null input", () => {
    expect(isZeroVector(null as any)).toBe(true);
  });

  it("returns false for vector with negative values", () => {
    expect(isZeroVector([0, -1, 0])).toBe(false);
  });
});

describe("isValidVector", () => {
  it("returns true for valid vector", () => {
    expect(isValidVector([1, 2, 3])).toBe(true);
  });

  it("returns true with correct dimension", () => {
    expect(isValidVector([1, 2, 3], 3)).toBe(true);
  });

  it("returns false with wrong dimension", () => {
    expect(isValidVector([1, 2, 3], 5)).toBe(false);
  });

  it("returns false for empty vector", () => {
    expect(isValidVector([])).toBe(false);
  });

  it("returns false for non-array", () => {
    expect(isValidVector("not array" as any)).toBe(false);
    expect(isValidVector(42 as any)).toBe(false);
  });

  it("returns false for NaN values", () => {
    expect(isValidVector([1, NaN, 3])).toBe(false);
  });

  it("returns false for Infinity values", () => {
    expect(isValidVector([1, Infinity, 3])).toBe(false);
  });
});

describe("vectorDimension", () => {
  it("returns correct dimension", () => {
    expect(vectorDimension([1, 2, 3])).toBe(3);
    expect(vectorDimension([1])).toBe(1);
  });

  it("returns 0 for empty vector", () => {
    expect(vectorDimension([])).toBe(0);
  });

  it("returns 0 for null input", () => {
    expect(vectorDimension(null as any)).toBe(0);
  });
});

describe("clampVector", () => {
  it("clamps values to range", () => {
    const result = clampVector([-2, 0.5, 3], -1, 1);
    expect(result).toEqual([-1, 0.5, 1]);
  });

  it("returns empty for null input", () => {
    expect(clampVector(null as any, 0, 1)).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(clampVector([], 0, 1)).toEqual([]);
  });

  it("handles all values in range", () => {
    const result = clampVector([0.1, 0.5, 0.9], 0, 1);
    expect(result).toEqual([0.1, 0.5, 0.9]);
  });
});

describe("lerpVectors", () => {
  it("returns a at t=0", () => {
    const result = lerpVectors([1, 2], [3, 4], 0);
    expect(result).toEqual([1, 2]);
  });

  it("returns b at t=1", () => {
    const result = lerpVectors([1, 2], [3, 4], 1);
    expect(result).toEqual([3, 4]);
  });

  it("returns midpoint at t=0.5", () => {
    const result = lerpVectors([0, 0], [10, 10], 0.5);
    expect(result).toEqual([5, 5]);
  });

  it("clamps t to [0, 1]", () => {
    const result = lerpVectors([0, 0], [10, 10], 2);
    expect(result).toEqual([10, 10]);
  });

  it("returns empty for mismatched dimensions", () => {
    expect(lerpVectors([1, 2], [1, 2, 3], 0.5)).toEqual([]);
  });

  it("returns empty for null input", () => {
    expect(lerpVectors(null as any, [1], 0.5)).toEqual([]);
  });
});

describe("softmax", () => {
  it("returns probabilities that sum to 1", () => {
    const result = softmax([1, 2, 3, 4]);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("returns all positive values", () => {
    const result = softmax([-10, 0, 10]);
    result.forEach((v) => expect(v).toBeGreaterThan(0));
  });

  it("assigns higher probability to higher input", () => {
    const result = softmax([1, 5, 2]);
    expect(result[1]).toBeGreaterThan(result[0]);
    expect(result[1]).toBeGreaterThan(result[2]);
  });

  it("returns equal probabilities for equal inputs", () => {
    const result = softmax([3, 3, 3, 3]);
    result.forEach((v) => expect(v).toBeCloseTo(0.25, 10));
  });

  it("returns empty for empty input", () => {
    expect(softmax([])).toEqual([]);
  });

  it("returns [1] for single element", () => {
    expect(softmax([42])).toEqual([1]);
  });

  it("handles extreme values without overflow", () => {
    const result = softmax([1000, 1001, 1002]);
    result.forEach((v) => {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    });
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe("rankByScore", () => {
  it("returns ranks in descending order", () => {
    const ranks = rankByScore([10, 50, 30, 20, 40]);
    expect(ranks[1]).toBe(0);
    expect(ranks[4]).toBe(1);
    expect(ranks[2]).toBe(2);
    expect(ranks[3]).toBe(3);
    expect(ranks[0]).toBe(4);
  });

  it("returns correct ranks for single element", () => {
    expect(rankByScore([100])).toEqual([0]);
  });

  it("returns empty array for empty input", () => {
    expect(rankByScore([])).toEqual([]);
  });

  it("handles equal scores", () => {
    const ranks = rankByScore([5, 5, 5]);
    expect(ranks).toHaveLength(3);
    ranks.forEach((r) => expect(r).toBeGreaterThanOrEqual(0));
    ranks.forEach((r) => expect(r).toBeLessThanOrEqual(2));
  });
});

describe("manhattanDistance", () => {
  it("returns 0 for identical vectors", () => {
    expect(manhattanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it("computes correct distance", () => {
    expect(manhattanDistance([0, 0], [3, 4])).toBe(7);
  });

  it("is symmetric", () => {
    const a = [1, 5, 9];
    const b = [2, 3, 7];
    expect(manhattanDistance(a, b)).toBe(manhattanDistance(b, a));
  });

  it("returns Infinity for mismatched dimensions", () => {
    expect(manhattanDistance([1, 2], [1, 2, 3])).toBe(Infinity);
  });

  it("returns Infinity for null input", () => {
    expect(manhattanDistance(null as any, [1])).toBe(Infinity);
  });

  it("handles negative values", () => {
    expect(manhattanDistance([-1, -2], [1, 2])).toBe(6);
  });
});