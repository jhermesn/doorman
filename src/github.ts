import { GATEWAY } from "./config.js";
import { type HttpClient, jsonBody } from "./http.js";

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  pull_request?: unknown;
  labels: { name: string }[];
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
}

export type StatusState = "pending" | "success" | "failure" | "error";

export class WriteNotAllowedError extends Error {}

/**
 * GitHub through the Sprites gateway. The connector's endpoint allowlist limits which
 * repositories are reachable at all; `writableRepos` limits which of them Doorman may change.
 */
export class GitHub {
  private readonly base: string;

  constructor(
    private readonly http: HttpClient,
    connectionId: string,
    private readonly writableRepos: ReadonlySet<string>,
  ) {
    this.base = `${GATEWAY}/github/${connectionId}`;
  }

  private headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

  private get<T>(path: string): Promise<T> {
    return this.http.json<T>(`${this.base}${path}`, { headers: this.headers });
  }

  private async write(repo: string, method: string, path: string, body: unknown): Promise<void> {
    if (!this.writableRepos.has(repo)) {
      throw new WriteNotAllowedError(`writes to ${repo} are not allowed by Doorman's config`);
    }
    const json = jsonBody(body);
    await this.http.request(`${this.base}/repos/${repo}${path}`, {
      method,
      body: json.body,
      headers: { ...this.headers, ...json.headers },
    });
  }

  issue(repo: string, n: number): Promise<Issue> {
    return this.get(`/repos/${repo}/issues/${n}`);
  }

  pull(repo: string, n: number): Promise<PullRequest> {
    return this.get(`/repos/${repo}/pulls/${n}`);
  }

  issues(repo: string, state: "open" | "closed" | "all", perPage = 50): Promise<Issue[]> {
    return this.get(`/repos/${repo}/issues?state=${state}&per_page=${perPage}`);
  }

  /** Signed, short-lived download URL for a source tarball (the gateway doesn't follow redirects). */
  async tarballUrl(repo: string, ref: string): Promise<string> {
    const response = await this.http.request(`${this.base}/repos/${repo}/tarball/${ref}`, {
      headers: this.headers,
      retries: 1,
      redirect: "manual",
    });
    const location = response.headers.get("location") ?? "";
    if (!location.startsWith("https://codeload.github.com/")) {
      throw new Error("unexpected tarball location");
    }
    return location;
  }

  comment(repo: string, n: number, body: string): Promise<void> {
    return this.write(repo, "POST", `/issues/${n}/comments`, { body });
  }

  addLabels(repo: string, n: number, labels: string[]): Promise<void> {
    return this.write(repo, "POST", `/issues/${n}/labels`, { labels });
  }

  setStatus(
    repo: string,
    sha: string,
    state: StatusState,
    description: string,
    targetUrl?: string,
  ): Promise<void> {
    return this.write(repo, "POST", `/statuses/${sha}`, {
      state,
      context: "doorman/repro",
      description: description.slice(0, 140),
      ...(targetUrl ? { target_url: targetUrl } : {}),
    });
  }
}
