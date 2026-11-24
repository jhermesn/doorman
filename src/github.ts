import { Octokit } from "@octokit/rest";

export class WriteNotAllowedError extends Error {}

export function ownerRepo(repo: string): { owner: string; repo: string } {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, repo: name };
}

/**
 * The connector's endpoint allowlist limits which repositories are reachable at all;
 * `writable` limits which of them Doorman may change.
 */
export function createGitHub(
  baseUrl: string,
  writable: ReadonlySet<string>,
  fetch?: typeof globalThis.fetch,
): Octokit {
  const github = new Octokit({
    baseUrl,
    userAgent: "doorman",
    ...(fetch ? { request: { fetch } } : {}),
  });
  github.hook.before("request", (options) => {
    if (options.method === "GET") return;
    const repo = `${options.owner}/${options.repo}`;
    if (!writable.has(repo)) {
      throw new WriteNotAllowedError(`writes to ${repo} are not allowed by Doorman's config`);
    }
  });
  return github;
}
