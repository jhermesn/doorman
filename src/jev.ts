import { GATEWAY } from "./config.js";
import { type HttpClient, jsonBody } from "./http.js";

export type Question =
  | { type: "noul"; instructions: string; criteria?: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number };

export interface JevResult<K extends string> {
  model: string;
  answers: Record<K, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

/** Typed decisions from TypeSafe's Jev, reached through the Sprites gateway. */
export class Jev {
  constructor(
    private readonly http: HttpClient,
    private readonly connectionId: string,
    private readonly model = "jev-latest",
  ) {}

  ask<K extends string>(state: unknown, questions: Record<K, Question>): Promise<JevResult<K>> {
    return this.http.json<JevResult<K>>(`${GATEWAY}/typesafe/${this.connectionId}/v1/systemone`, {
      method: "POST",
      timeoutMs: 15_000,
      ...jsonBody({ model: this.model, state, questions }),
    });
  }
}

export function noul(answer: Answer | undefined): number {
  if (answer?.type !== "noul") throw new Error("expected a noul answer");
  return answer.noul;
}

export function choice(answer: Answer | undefined): { choice: string; confidence: number } {
  if (answer?.type !== "choice") throw new Error("expected a choice answer");
  return { choice: answer.choice, confidence: answer.confidence };
}

export function score(answer: Answer | undefined): number {
  if (answer?.type !== "score") throw new Error("expected a score answer");
  return answer.score;
}
