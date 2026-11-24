import { readFileSync } from "node:fs";
import { SpritesClient } from "@fly/sprites";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** The exec connection dropped: the worker rebooted (for example on its memory cap) or vanished. */
  crashed: boolean;
}

/**
 * Everything Doorman may do to a worker Sprite. Deliberately missing: policy changes,
 * creation and deletion. Those happen once, at bootstrap, from a maintainer's machine.
 */
export interface Workers {
  reset(worker: string, checkpoint: string): Promise<void>;
  run(
    worker: string,
    command: string,
    opts: { cwd: string; timeoutMs: number },
  ): Promise<RunResult>;
  writeFile(worker: string, path: string, content: string): Promise<void>;
  readFile(worker: string, path: string): Promise<string>;
  checkpoint(worker: string, comment: string): Promise<string>;
}

export class WorkerNameError extends Error {}

const MAX_OUTPUT = 64 * 1024;

export function clip(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n… [${text.length - max} bytes elided] …\n${text.slice(-half)}`;
}

export class SpritesWorkers implements Workers {
  private readonly client: SpritesClient;

  constructor(
    tokenFile: string,
    private readonly prefix: string,
  ) {
    const token = readFileSync(tokenFile, "utf8").trim();
    if (!token) throw new Error(`Sprites token file ${tokenFile} is empty`);
    this.client = new SpritesClient(token);
  }

  private sprite(name: string) {
    if (!name.startsWith(this.prefix)) {
      throw new WorkerNameError(
        `refusing to touch "${name}": workers must start with "${this.prefix}"`,
      );
    }
    return this.client.sprite(name);
  }

  async reset(worker: string, checkpoint: string): Promise<void> {
    const stream = await this.sprite(worker).restoreCheckpoint(checkpoint);
    await stream.processAll((msg) => {
      if (msg.type === "error")
        throw new Error(`restore ${checkpoint} failed: ${msg.error ?? msg.data}`);
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const probe = await this.run(worker, "true", { cwd: "/", timeoutMs: 10_000 });
      if (!probe.crashed && probe.exitCode === 0) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`worker ${worker} did not come back after restoring ${checkpoint}`);
  }

  async run(
    worker: string,
    command: string,
    opts: { cwd: string; timeoutMs: number },
  ): Promise<RunResult> {
    const started = Date.now();
    try {
      const result = await this.sprite(worker).execFile("bash", ["-lc", command], {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: 4 * MAX_OUTPUT,
      });
      return {
        exitCode: result.exitCode,
        stdout: clip(String(result.stdout)),
        stderr: clip(String(result.stderr)),
        durationMs: Date.now() - started,
        crashed: false,
      };
    } catch (error) {
      if (error instanceof WorkerNameError) throw error;
      return {
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
        crashed: true,
      };
    }
  }

  writeFile(worker: string, path: string, content: string): Promise<void> {
    return this.sprite(worker).filesystem().writeFile(path, content);
  }

  readFile(worker: string, path: string): Promise<string> {
    return this.sprite(worker).filesystem().readFile(path, "utf8");
  }

  async checkpoint(worker: string, comment: string): Promise<string> {
    const stream = await this.sprite(worker).createCheckpoint(comment);
    let id = "";
    await stream.processAll((msg) => {
      if (msg.type === "error") throw new Error(`checkpoint failed: ${msg.error ?? msg.data}`);
      const match = msg.data?.match(/\b(v\d+)\b/);
      if (match?.[1]) id = match[1];
    });
    return id;
  }
}
