import type { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  generateText,
  hasToolCall,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import type { Step } from "../runlog.js";
import { fill, text } from "../text.js";
import type { Workers } from "../workers.js";
import { gate } from "./gate.js";

export const REPRO_FILE = ".doorman/repro.sh";

const t = text.reproduce;

export interface ReproOutcome {
  /** "unfinished": the model ran out of steps without calling finish; the script may still prove the bug. */
  claim: "reproduced" | "not-reproduced" | "needs-info" | "unfinished";
  summary: string;
  missingInfo?: string;
  steps: Step[];
  tokensIn: number;
  tokensOut: number;
  jevCalls: number;
  crashed: boolean;
}

export interface ReproContext {
  repo: string;
  worker: string;
  dir: string;
  issueTitle: string;
  issueBody: string;
  memory: string;
  maxSteps: number;
  commandTimeoutMs: number;
}

const Finish = z.object({
  claim: z.enum(["reproduced", "not-reproduced", "needs-info"]),
  summary: z.string().describe(t.tools.summary),
  missing_info: z.string().optional().describe(t.tools.missingInfo),
});

function systemPrompt(ctx: ReproContext): string {
  return fill(t.system.join("\n"), {
    repo: ctx.repo,
    dir: ctx.dir,
    reproFile: REPRO_FILE,
    notes: ctx.memory || t.noNotes,
  });
}

export async function reproduce(
  model: LanguageModel,
  jev: TypeSafeClient | undefined,
  workers: Workers,
  ctx: ReproContext,
): Promise<ReproOutcome> {
  const report = `${ctx.issueTitle}\n\n${ctx.issueBody}`.slice(0, 4_000);
  const steps: Step[] = [];
  let crashed = false;

  const tools = {
    run: tool({
      description: t.tools.run,
      inputSchema: z.object({ cmd: z.string() }),
      execute: async ({ cmd }) => {
        const step: Step = { cmd, ...(jev && { gate: await gate(jev, cmd) }) };
        steps.push(step);
        if (step.gate?.decision === "block") {
          return t.results.blocked;
        }
        const r = await workers.run(ctx.worker, cmd, {
          cwd: ctx.dir,
          timeoutMs: ctx.commandTimeoutMs,
        });
        Object.assign(step, { exitCode: r.exitCode, ms: r.durationMs, crashed: r.crashed });
        crashed ||= r.crashed;
        return `exit ${r.exitCode}\n--- stdout ---\n${r.stdout.slice(-4_000)}\n--- stderr ---\n${r.stderr.slice(-4_000)}`;
      },
    }),
    write_file: tool({
      description: t.tools.writeFile,
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const relative = path.replace(/^\/+/, "");
        if (relative.split("/").includes("..")) return t.results.outsideRepo;
        await workers.writeFile(ctx.worker, `${ctx.dir}/${relative}`, content);
        return `wrote ${relative}`;
      },
    }),
    finish: tool({
      description: fill(t.tools.finish, { reproFile: REPRO_FILE }),
      inputSchema: Finish,
      execute: async () => "done",
    }),
  };

  const messages: ModelMessage[] = [{ role: "user", content: fill(t.prompt, { report }) }];
  let finish: z.infer<typeof Finish> | undefined;
  let modelSteps = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  // Ollama ignores toolChoice "required", so a reply without a tool call gets a nudge.
  while (!finish && !crashed && modelSteps < ctx.maxSteps) {
    const result = await generateText({
      model,
      system: systemPrompt(ctx),
      messages,
      tools,
      temperature: 0.2,
      stopWhen: [stepCountIs(ctx.maxSteps - modelSteps), hasToolCall("finish"), () => crashed],
    });
    modelSteps += result.steps.length;
    tokensIn += result.totalUsage.inputTokens ?? 0;
    tokensOut += result.totalUsage.outputTokens ?? 0;
    const call = result.steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === "finish");
    finish = Finish.safeParse(call?.input).data;
    messages.push(...result.response.messages, {
      role: "user",
      content: fill(t.nudge, { reproFile: REPRO_FILE }),
    });
  }

  const usage = {
    steps,
    tokensIn,
    tokensOut,
    jevCalls: steps.filter((s) => s.gate).length,
    crashed,
  };
  if (crashed) {
    return {
      ...usage,
      claim: "not-reproduced",
      summary: t.results.crashed,
    };
  }
  if (!finish) {
    return {
      ...usage,
      claim: "unfinished",
      summary: t.results.noConclusion,
    };
  }
  return {
    ...usage,
    claim: finish.claim,
    summary: finish.summary.slice(0, 1_000),
    ...(finish.missing_info ? { missingInfo: finish.missing_info.slice(0, 500) } : {}),
  };
}
