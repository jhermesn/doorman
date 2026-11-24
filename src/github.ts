import { Octokit } from "@octokit/rest";

export class WriteNotAllowedError extends Error {}

/** Marks Doorman's own comments so a rerun edits its report instead of adding another. */
const MARKER = "<!-- doorman -->";
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

interface IssueRef {
  owner: string;
  repo: string;
  issue_number: number;
}

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

/**
 * Idempotent comment: a rerun of the same job updates the report. Only comments by people with
 * write access count, so a stranger can't plant the marker and have Doorman overwrite their text.
 */
export async function upsertComment(github: Octokit, issue: IssueRef, body: string): Promise<void> {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...issue,
    per_page: 100,
  });
  const previous = comments.find(
    (c) => c.body?.startsWith(MARKER) && TRUSTED.has(c.author_association),
  );
  const marked = `${MARKER}\n${body}`;
  if (previous) {
    await github.rest.issues.updateComment({
      owner: issue.owner,
      repo: issue.repo,
      comment_id: previous.id,
      body: marked,
    });
  } else {
    await github.rest.issues.createComment({ ...issue, body: marked });
  }
}
