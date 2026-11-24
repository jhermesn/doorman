export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** "manual" returns 3xx responses instead of following them. */
  redirect?: "follow" | "manual";
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} from ${redactUrl(url)}: ${body.slice(0, 200)}`);
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

export function redactUrl(url: string): string {
  return url.replace(/\?.*$/, "?…");
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 250 * 2 ** attempt;
  return Math.min(8_000, base) * (0.5 + random() / 2);
}

export interface HttpClient {
  request(url: string, options?: RequestOptions): Promise<Response>;
  json<T>(url: string, options?: RequestOptions): Promise<T>;
}

export function createHttpClient(
  fetchImpl: FetchLike = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): HttpClient {
  async function request(url: string, options: RequestOptions = {}): Promise<Response> {
    const retries = options.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const init: RequestInit = {
        method: options.method ?? "GET",
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
        redirect: options.redirect ?? "follow",
      };
      if (options.body !== undefined) init.body = options.body;
      if (options.headers !== undefined) init.headers = options.headers;
      try {
        const response = await fetchImpl(url, init);
        const redirected =
          options.redirect === "manual" && response.status >= 300 && response.status < 400;
        if (response.ok || redirected) return response;
        if (!RETRYABLE.has(response.status) || attempt >= retries) {
          throw new HttpError(response.status, url, await response.text());
        }
      } catch (error) {
        if (error instanceof HttpError || attempt >= retries) throw error;
      }
      await sleep(backoffMs(attempt));
    }
  }

  return {
    request,
    async json<T>(url: string, options: RequestOptions = {}): Promise<T> {
      const response = await request(url, options);
      return (await response.json()) as T;
    },
  };
}

export function jsonBody(value: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(value), headers: { "Content-Type": "application/json" } };
}
