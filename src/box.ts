import { GATEWAY } from "./config.js";
import { type HttpClient, jsonBody } from "./http.js";

interface Item {
  type: "file" | "folder" | "web_link";
  id: string;
  name: string;
}

/**
 * Human-editable agent memory: Markdown files in a Box folder, one subfolder per repository.
 * The connector can read, create and version files, but cannot delete them.
 */
export class BoxMemory {
  private readonly base: string;

  constructor(
    private readonly http: HttpClient,
    connectionId: string,
    private readonly rootFolderId: string,
  ) {
    this.base = `${GATEWAY}/box/${connectionId}`;
  }

  private async items(folderId: string): Promise<Item[]> {
    const page = await this.http.json<{ entries: Item[] }>(
      `${this.base}/2.0/folders/${folderId}/items?fields=type,id,name&limit=1000`,
    );
    return page.entries;
  }

  async folderFor(repo: string): Promise<string> {
    const name = repo.replace("/", "__");
    const existing = (await this.items(this.rootFolderId)).find(
      (i) => i.type === "folder" && i.name === name,
    );
    if (existing) return existing.id;
    const created = await this.http.json<{ id: string }>(`${this.base}/2.0/folders`, {
      method: "POST",
      ...jsonBody({ name, parent: { id: this.rootFolderId } }),
    });
    return created.id;
  }

  /** Returns the file's text, or undefined when it doesn't exist yet. */
  async read(folderId: string, name: string): Promise<string | undefined> {
    const file = (await this.items(folderId)).find((i) => i.type === "file" && i.name === name);
    if (!file) return undefined;
    const response = await this.http.request(`${this.base}/2.0/files/${file.id}/content`);
    return response.text();
  }

  /** Creates the file, or uploads a new version so Box keeps the history. */
  async write(folderId: string, name: string, text: string): Promise<void> {
    const file = (await this.items(folderId)).find((i) => i.type === "file" && i.name === name);
    const form = new FormData();
    form.append("attributes", JSON.stringify(file ? { name } : { name, parent: { id: folderId } }));
    form.append("file", new Blob([text], { type: "text/markdown" }), name);
    const path = file ? `/upload/files/${file.id}/content` : "/upload/files/content";
    await this.http.request(`${this.base}${path}`, { method: "POST", body: form });
  }

  async append(folderId: string, name: string, entry: string): Promise<void> {
    const current = (await this.read(folderId, name)) ?? `# ${name.replace(/\.md$/, "")}\n`;
    await this.write(folderId, name, `${current.trimEnd()}\n\n${entry.trim()}\n`);
  }
}

export const MEMORY_FILES = ["env.md", "quirks.md", "policy.md"] as const;
