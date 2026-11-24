import { GATEWAY } from "./config.js";
import { type HttpClient, jsonBody } from "./http.js";

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required: string[] };
  };
}

export interface ChatResponse {
  message: Message;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Open models on Ollama Cloud, reached through the Sprites gateway. */
export class Ollama {
  constructor(
    private readonly http: HttpClient,
    private readonly connectionId: string,
  ) {}

  chat(model: string, messages: Message[], tools: ToolSpec[] = []): Promise<ChatResponse> {
    return this.http.json<ChatResponse>(`${GATEWAY}/ollama/${this.connectionId}/api/chat`, {
      method: "POST",
      timeoutMs: 120_000,
      ...jsonBody({ model, messages, tools, stream: false, options: { temperature: 0.2 } }),
    });
  }
}
