import { describe, expect, it } from "vitest";
import { backoffMs, createHttpClient, HttpError } from "../src/http.js";

function fakeFetch(statuses: number[]) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)] ?? 200;
    return new Response(status === 200 ? '{"ok":true}' : "nope", { status });
  };
  return { impl, calls };
}

const noSleep = async () => {};

describe("http client", () => {
  it("given a 429 then a 200, when requested, then it retries and succeeds", async () => {
    const { impl, calls } = fakeFetch([429, 200]);
    const http = createHttpClient(impl, noSleep);
    await expect(http.json("https://x/a")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("given a 403, when requested, then it fails without retrying", async () => {
    const { impl, calls } = fakeFetch([403]);
    const http = createHttpClient(impl, noSleep);
    await expect(http.request("https://x/a?secret=1")).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
  });

  it("given persistent 503s, when requested, then it gives up after the retry budget", async () => {
    const { impl, calls } = fakeFetch([503]);
    const http = createHttpClient(impl, noSleep);
    await expect(http.request("https://x/a", { retries: 2 })).rejects.toThrow("HTTP 503");
    expect(calls).toHaveLength(3);
  });

  it("given an error, when it is described, then the query string is hidden", () => {
    expect(new HttpError(500, "https://x/a?token=abc", "").message).not.toContain("token=abc");
  });
});

describe("backoffMs", () => {
  it.each([
    [0, 125, 250],
    [3, 1_000, 2_000],
    [10, 4_000, 8_000],
  ])(
    "given attempt %i, when computed, then the delay stays between %i and %i ms",
    (attempt, min, max) => {
      expect(backoffMs(attempt, () => 0)).toBe(min);
      expect(backoffMs(attempt, () => 1)).toBe(max);
    },
  );
});
