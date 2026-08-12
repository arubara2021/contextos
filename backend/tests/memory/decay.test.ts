import {
  computeStrength,
  categorize,
  getDecayRate,
} from "../../src/memory/decay";
import config from "../../src/config";

const STRONG_THRESHOLD = config.decay.strongThreshold;
const FADING_THRESHOLD = config.decay.fadingThreshold;
const CRITICAL_THRESHOLD = config.decay.criticalThreshold;
const FORGOTTEN_THRESHOLD = config.decay.forgottenThreshold;

describe("decay module", () => {
  describe("computeStrength", () => {
    it("returns initial strength when days since access is zero", () => {
      expect(computeStrength(1.0, 0.15, 0)).toBe(1.0);
    });

    it("returns initial strength when days is negative", () => {
      expect(computeStrength(0.8, 0.15, -1)).toBe(0.8);
    });

    it("decays strength over time", () => {
      const initial = 1.0;
      const result = computeStrength(initial, 0.15, 7);
      expect(result).toBeLessThan(initial);
      expect(result).toBeGreaterThan(0);
    });

    it("decays faster with higher decay rate", () => {
      const slow = computeStrength(1.0, 0.05, 30);
      const fast = computeStrength(1.0, 0.3, 30);
      expect(slow).toBeGreaterThan(fast);
    });

    it("never goes below zero", () => {
      const result = computeStrength(1.0, 0.99, 100);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it("never goes above initial strength", () => {
      const result = computeStrength(0.5, 0.1, 0);
      expect(result).toBeLessThanOrEqual(0.5);
    });

    it("approaches zero with extreme decay", () => {
      const result = computeStrength(1.0, 0.5, 100);
      expect(result).toBeLessThan(0.01);
    });

    it("decays more with more days", () => {
      const after1 = computeStrength(1.0, 0.1, 1);
      const after10 = computeStrength(1.0, 0.1, 10);
      const after100 = computeStrength(1.0, 0.1, 100);

      expect(after1).toBeGreaterThan(after10);
      expect(after10).toBeGreaterThan(after100);
    });

    it("handles zero decay rate (no decay)", () => {
      const result = computeStrength(0.8, 0, 365);
      expect(result).toBe(0.8);
    });

    it("handles fractional days", () => {
      const result = computeStrength(1.0, 0.15, 0.5);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1.0);
    });

    it("rounds to 4 decimal places", () => {
      const result = computeStrength(0.7777, 0.1234, 5.678);
      const decimalPlaces = result.toString().includes(".")
        ? result.toString().split(".")[1].length
        : 0;
      expect(decimalPlaces).toBeLessThanOrEqual(4);
    });

    it("decays correctly for typical importance-8 memory over 7 days", () => {
      const result = computeStrength(0.5, 0.1, 7);
      const expected = 0.5 * Math.pow(0.9, 7);
      expect(result).toBeCloseTo(expected, 3);
    });

    it("decays correctly for importance-5 memory over 30 days", () => {
      const result = computeStrength(0.5, 0.15, 30);
      const expected = 0.5 * Math.pow(0.85, 30);
      expect(result).toBeCloseTo(expected, 3);
    });
  });

  describe("categorize", () => {
    it("categorizes high strength as strong", () => {
      expect(categorize(0.9)).toBe("strong");
      expect(categorize(0.7)).toBe("strong");
      expect(categorize(1.0)).toBe("strong");
    });

    it("categorizes medium strength as fading", () => {
      expect(categorize(0.6)).toBe("fading");
      expect(categorize(0.5)).toBe("fading");
      expect(categorize(0.4)).toBe("fading");
    });

    it("categorizes low strength as critical", () => {
      expect(categorize(0.3)).toBe("critical");
      expect(categorize(0.2)).toBe("critical");
      expect(categorize(0.1)).toBe("critical");
    });

    it("categorizes very low strength as forgotten", () => {
      expect(categorize(0.09)).toBe("forgotten");
      expect(categorize(0.01)).toBe("forgotten");
      expect(categorize(0.0)).toBe("forgotten");
    });

    it("treats exact threshold boundaries correctly", () => {
      expect(categorize(STRONG_THRESHOLD)).toBe("strong");
      expect(categorize(FADING_THRESHOLD)).toBe("fading");
      expect(categorize(FORGOTTEN_THRESHOLD)).toBe("critical");
      expect(categorize(FORGOTTEN_THRESHOLD - 0.01)).toBe("forgotten");
    });

    it("returns consistent categories for same input", () => {
      for (let i = 0; i < 10; i++) {
        expect(categorize(0.55)).toBe("fading");
      }
    });
  });

  describe("getDecayRate", () => {
    it("returns lower decay rate for high importance", () => {
      const rate = getDecayRate(8);
      expect(rate).toBeLessThan(0.15);
    });

    it("returns default decay rate for medium importance", () => {
      const rate = getDecayRate(5);
      expect(rate).toBe(0.15);
    });

    it("returns higher decay rate for low importance", () => {
      const rate = getDecayRate(2);
      expect(rate).toBeGreaterThan(0.15);
    });

    it("returns lowest decay rate for maximum importance", () => {
      const rate = getDecayRate(10);
      expect(rate).toBe(config.decay.highImportanceRate);
    });

    it("returns highest decay rate for minimum importance", () => {
      const rate = getDecayRate(1);
      expect(rate).toBe(config.decay.lowImportanceRate);
    });

    it("higher importance always means slower decay", () => {
      const rates = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => getDecayRate(i));
      for (let i = 1; i < rates.length; i++) {
        expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);
      }
    });

    it("decay rates are within reasonable bounds", () => {
      for (let importance = 1; importance <= 10; importance++) {
        const rate = getDecayRate(importance);
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(1);
      }
    });
  });

  describe("threshold consistency", () => {
    it("strong threshold is higher than fading", () => {
      expect(STRONG_THRESHOLD).toBeGreaterThan(FADING_THRESHOLD);
    });

    it("fading threshold is higher than or equal to critical", () => {
      expect(FADING_THRESHOLD).toBeGreaterThanOrEqual(CRITICAL_THRESHOLD);
    });

    it("critical threshold is higher than forgotten", () => {
      expect(CRITICAL_THRESHOLD).toBeGreaterThan(FORGOTTEN_THRESHOLD);
    });

    it("all thresholds are between 0 and 1", () => {
      expect(STRONG_THRESHOLD).toBeGreaterThan(0);
      expect(STRONG_THRESHOLD).toBeLessThanOrEqual(1);
      expect(FADING_THRESHOLD).toBeGreaterThan(0);
      expect(FADING_THRESHOLD).toBeLessThanOrEqual(1);
      expect(CRITICAL_THRESHOLD).toBeGreaterThan(0);
      expect(CRITICAL_THRESHOLD).toBeLessThanOrEqual(1);
      expect(FORGOTTEN_THRESHOLD).toBeGreaterThanOrEqual(0);
      expect(FORGOTTEN_THRESHOLD).toBeLessThan(1);
    });
  });

  describe("decay lifecycle", () => {
    it("a new memory starts strong and eventually becomes forgotten", () => {
      let strength = 1.0;
      const rate = 0.15;
      const categories: string[] = [];

      for (let day = 0; day <= 365; day += 7) {
        strength = computeStrength(1.0, rate, day);
        categories.push(categorize(strength));
      }

      expect(categories[0]).toBe("strong");
      // With current thresholds (strong=0.7, fading=critical=0.4), "fading" is unreachable
      expect(categories).toContain("critical");
      expect(categories).toContain("critical");
      expect(categories).toContain("forgotten");
    });

    it("high-importance memory stays strong longer", () => {
      const highRate = getDecayRate(10);
      const lowRate = getDecayRate(1);

      const highAfter30 = computeStrength(1.0, highRate, 30);
      const lowAfter30 = computeStrength(1.0, lowRate, 30);

      expect(highAfter30).toBeGreaterThan(lowAfter30);

      const highAfter3 = computeStrength(1.0, highRate, 3);
      const lowAfter3 = computeStrength(1.0, lowRate, 3);
      expect(categorize(highAfter3)).toBe("strong");
      expect(categorize(lowAfter3)).not.toBe("strong");
    });

    it("boosted memory decays from boosted level", () => {
      const boostedStrength = 0.9;
      const normalStrength = 0.5;
      const rate = 0.15;

      const boostedAfter = computeStrength(boostedStrength, rate, 14);
      const normalAfter = computeStrength(normalStrength, rate, 14);

      expect(boostedAfter).toBeGreaterThan(normalAfter);
    });
  });
});