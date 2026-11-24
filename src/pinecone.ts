import { GATEWAY } from "./config.js";
import { type HttpClient, jsonBody } from "./http.js";

export interface IssueRecord {
  _id: string;
  text: string;
  [field: string]: string | number | boolean;
}

export interface Hit {
  id: string;
  score: number;
  fields: Record<string, unknown>;
}

const VERSION = { "X-Pinecone-API-Version": "2025-04" };

/**
 * Issue memory in a Pinecone index with integrated embedding.
 * The connector forwards data-plane routes only; the index is created once at bootstrap.
 */
export class IssueMemory {
  private readonly base: string;

  constructor(
    private readonly http: HttpClient,
    connectionId: string,
    index: string,
  ) {
    this.base = `${GATEWAY}/pinecone/${connectionId}/indexes/${index}/records/namespaces`;
  }

  async upsert(namespace: string, records: IssueRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.http.request(`${this.base}/${encodeURIComponent(namespace)}/upsert`, {
      method: "POST",
      body: records.map((r) => JSON.stringify(r)).join("\n"),
      headers: { "Content-Type": "application/x-ndjson", ...VERSION },
    });
  }

  async similar(namespace: string, text: string, topK = 5): Promise<Hit[]> {
    const body = jsonBody({ query: { inputs: { text }, top_k: topK }, fields: ["text", "title"] });
    const result = await this.http.json<{
      result: { hits: { _id: string; _score: number; fields: Record<string, unknown> }[] };
    }>(`${this.base}/${encodeURIComponent(namespace)}/search`, {
      method: "POST",
      ...body,
      headers: { ...body.headers, ...VERSION },
    });
    return result.result.hits.map((h) => ({ id: h._id, score: h._score, fields: h.fields }));
  }
}

export function namespaceFor(repo: string): string {
  return repo.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
