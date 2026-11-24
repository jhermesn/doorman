import type { Index } from "@pinecone-database/pinecone";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { text } from "../text.js";

export interface IssueLike {
  number: number;
  title: string;
  body?: string | null;
}

export interface Screening {
  injectionP: number;
  kind: "bug" | "question" | "feature" | "docs" | "spam";
  actionable: boolean;
  duplicateOf: { number: number; p: number } | null;
  jevCalls: number;
}

export function issueText(issue: Pick<IssueLike, "title" | "body">): string {
  return `${issue.title}\n\n${issue.body ?? ""}`.trim();
}

/** Without Jev nothing is screened: every report goes to the worker, whose policies still hold. */
const UNSCREENED: Screening = {
  injectionP: 0,
  kind: "bug",
  actionable: true,
  duplicateOf: null,
  jevCalls: 0,
};

export async function screen(
  jev: TypeSafeClient | undefined,
  index: Index | undefined,
  issue: IssueLike,
): Promise<Screening> {
  if (!jev) return UNSCREENED;
  const report = issueText(issue);
  const { answers } = await jev.systemOne({
    state: { issue_title: issue.title, issue_body: (issue.body ?? "").slice(0, 12_000) },
    questions: {
      injection: { type: "noul", instructions: text.jev.injection },
      kind: { type: "choice", ...text.jev.kind },
      actionable: { type: "noul", instructions: text.jev.actionable },
    },
  });
  const duplicate = index ? await findDuplicate(jev, index, issue.number, report) : undefined;
  return {
    injectionP: answers.injection.noul,
    kind: answers.kind.choice,
    actionable: answers.actionable.noul >= 0.5,
    duplicateOf: duplicate?.match ?? null,
    jevCalls: 1 + (duplicate?.jevCalls ?? 0),
  };
}

/** Pinecone proposes the nearest earlier report; Jev decides whether it is the same defect. */
async function findDuplicate(jev: TypeSafeClient, index: Index, number: number, report: string) {
  const { result } = await index.searchRecords({
    query: { topK: 3, inputs: { text: report } },
    fields: ["text"],
  });
  const best = result.hits.find((h) => h._id !== `issue-${number}`);
  if (!best || best._score < 0.3) return { match: null, jevCalls: 0 };
  const { answers } = await jev.systemOne({
    state: {
      report_a: report.slice(0, 6_000),
      report_b: String((best.fields as { text?: string }).text ?? "").slice(0, 6_000),
    },
    questions: { same: { type: "noul", instructions: text.jev.duplicate } },
  });
  const p = answers.same.noul;
  const match = p >= 0.75 ? { number: Number(best._id.replace("issue-", "")), p } : null;
  return { match, jevCalls: 1 };
}
