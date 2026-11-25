import { readFileSync } from "node:fs";
import { z } from "zod";

/** Read from package.json, which sits one level above both src/ and dist/. */
export const VERSION = z
  .object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))).version;
