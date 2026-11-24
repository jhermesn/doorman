import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { BoxClient, BoxDeveloperTokenAuth } from "box-node-sdk";

/** Maintainer-owned notes. Doorman reads them as trusted guidance and never writes them. */
export const MEMORY_FILES = ["env.md", "quirks.md", "policy.md"] as const;

export class ProtectedFileError extends Error {}

export function createBox(baseUrl: string, token: string): BoxClient {
  return (
    new BoxClient({ auth: new BoxDeveloperTokenAuth({ token }) })
      .withCustomBaseUrls({
        baseUrl,
        uploadUrl: `${baseUrl}/upload`,
        oauth2Url: `${baseUrl}/oauth2`,
      })
      // The connector serves uploads at /upload/files/..., without the /2.0 the SDK adds.
      .withInterceptors([
        {
          beforeRequest: (o) => ({
            ...o,
            url: o.url.replace(`${baseUrl}/upload/2.0/`, `${baseUrl}/upload/`),
          }),
          afterRequest: (r) => r,
        },
      ])
  );
}

/**
 * Human-editable agent memory: Markdown files in a Box folder, one subfolder per repository.
 * The connector can read, create and version files, but cannot delete them.
 */
export class BoxMemory {
  constructor(
    private readonly box: BoxClient,
    private readonly rootFolderId: string,
  ) {}

  private async find(folderId: string, type: "file" | "folder", name: string) {
    const items = await this.box.folders.getFolderItems(folderId, { queryParams: { limit: 1000 } });
    return items.entries?.find((i) => i.type === type && i.name === name)?.id;
  }

  async folderFor(repo: string): Promise<string> {
    const name = repo.replace("/", "__");
    const existing = await this.find(this.rootFolderId, "folder", name);
    if (existing) return existing;
    return (await this.box.folders.createFolder({ name, parent: { id: this.rootFolderId } })).id;
  }

  /** Returns the file's text, or undefined when it doesn't exist yet. */
  async read(folderId: string, name: string): Promise<string | undefined> {
    const id = await this.find(folderId, "file", name);
    const stream = id ? await this.box.downloads.downloadFile(id) : undefined;
    return stream ? text(stream) : undefined;
  }

  /** Creates the file, or uploads a new version so Box keeps the history. */
  async write(folderId: string, name: string, content: string): Promise<void> {
    if ((MEMORY_FILES as readonly string[]).includes(name)) {
      throw new ProtectedFileError(`${name} is maintainer-owned; Doorman only reads it`);
    }
    const id = await this.find(folderId, "file", name);
    const file = Readable.from([Buffer.from(content)]);
    if (id) await this.box.uploads.uploadFileVersion(id, { attributes: { name }, file });
    else
      await this.box.uploads.uploadFile({ attributes: { name, parent: { id: folderId } }, file });
  }

  async append(folderId: string, name: string, entry: string): Promise<void> {
    const current = (await this.read(folderId, name)) ?? `# ${name.replace(/\.md$/, "")}\n`;
    await this.write(folderId, name, `${current.trimEnd()}\n\n${entry.trim()}\n`);
  }
}
