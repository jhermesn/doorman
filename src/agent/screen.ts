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

export async function screen(
  jev: TypeSafeClient,
  index: Index,
  issue: IssueLike,
): Promise<Screening> {
  const report = issueText(issue);
  const { answers } = await jev.systemOne({
    state: { issue_title: issue.title, issue_body: (issue.body ?? "").slice(0, 12_000) },
    questions: {
      injection: { type: "noul", instructions: text.jev.injection },
      kind: { type: "choice", ...text.jev.kind },
      actionable: { type: "noul", instructions: text.jev.actionable },
    },
  });

  let jevCalls = 1;
  let duplicateOf: Screening["duplicateOf"] = null;
  const { result } = await index.searchRecords({
    query: { topK: 3, inputs: { text: report } },
    fields: ["text"],
  });
  const best = result.hits.find((h) => h._id !== `issue-${issue.number}`);
  if (best && best._score >= 0.3) {
    const dup = await jev.systemOne({
      state: {
        report_a: report.slice(0, 6_000),
        report_b: String((best.fields as { text?: string }).text ?? "").slice(0, 6_000),
      },
      questions: { same: { type: "noul", instructions: text.jev.duplicate } },
    });
    jevCalls++;
    const p = dup.answers.same.noul;
    if (p >= 0.75) duplicateOf = { number: Number(best._id.replace("issue-", "")), p };
  }

  return {
    injectionP: answers.injection.noul,
    kind: answers.kind.choice,
    actionable: answers.actionable.noul >= 0.5,
    duplicateOf,
    jevCalls,
  };
}
