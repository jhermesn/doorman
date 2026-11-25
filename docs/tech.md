# Tech

- **Runtime:** Node 24 (preinstalled on Sprites), TypeScript 7, ESM.
- **Libraries:** official SDKs pointed at the Sprites connector gateway: `@fly/sprites`, `@octokit/rest`, `@typesafe-ai/sdk`, `@pinecone-database/pinecone`, `box-node-sdk`, and the AI SDK (`ai`, `@ai-sdk/openai-compatible`) for Ollama. `zod` validates the config.
- **Models:** Ollama Cloud drives the reproduction; TypeSafe Jev answers the typed yes/no questions.
- **Storage:** Pinecone (integrated embedding) for similar issues, Box for notes and stored reproductions. Run events go to stderr, and the caller keeps them (for example `2>> runs.jsonl`).
- **Dev tools:** Vitest, Biome, `tsc`.

## Commands

```bash
npm ci
npm run check    # lint, typecheck and tests (what CI runs)
npm run build    # compiles to dist/
npm run format   # Biome formatter
```

## Platform behaviour the code relies on

- Connector calls work only from a Sprite whose name matches the connector's policy; anywhere else the gateway answers 401 or 403.
- The gateway doesn't follow redirects. GitHub tarball URLs come back as a 302 to a signed `codeload` address.
- The Pinecone connector forwards data operations only, so indexes are created once, outside the Sprite.
- The Box connector can read, create and version files, but can't delete them or list versions. It serves uploads at `/upload/files/...` while the Box SDK asks for `/upload/2.0/files/...`, so `createBox` rewrites that prefix.
- Ollama's OpenAI-compatible endpoint ignores `toolChoice: "required"`, so the reproduction loop nudges the model when it answers without a tool call.
- Restoring a checkpoint restarts the Sprite and ends its sessions (about 3 s on a small overlay), which is why Doorman never restores its own Sprite.
- A worker's memory cap takes effect after a restart, and going over it reboots the worker. Doorman reports a dropped exec as `oom`.
- The HTTP exec endpoint has no frame lengths, so Doorman uses the SDK's WebSocket exec.

The measurements behind these are in [platform.md](platform.md).
