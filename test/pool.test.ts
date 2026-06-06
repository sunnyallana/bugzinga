import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/util/pool.js";

describe("mapWithConcurrency", () => {
  it("preserves order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10 + (n % 3) * 10));
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("handles empty input and limit larger than items", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1], 8, async (x) => x + 1)).toEqual([2]);
  });
});
