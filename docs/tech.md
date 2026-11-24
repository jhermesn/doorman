# Tech

|              |                                                                                                                               |
| :----------- | :---------------------------------------------------------------------------------------------------------------------------- |
| Runtime      | Node 24 (preinstalled on Sprites), TypeScript 7, ESM                                                                          |
| Dependencies | `@fly/sprites` only; everything else uses `fetch`                                                                             |
| Dev tools    | Vitest, Biome, `tsc`                                                                                                          |
| Models       | Ollama Cloud for the reproduction loop; TypeSafe Jev for typed decisions                                                      |
| Storage      | Pinecone (integrated embedding) for issue similarity; Box for notes and stored reproductions; `runs.jsonl` on the home Sprite |

## Commands

```bash
npm ci
npm run check    # lint + typecheck + tests (what CI runs)
npm run build    # compiles to dist/
npm run format   # Biome formatter
```

## Platform facts the code depends on

- Connector calls must come from inside a Sprite whose name matches the connector's policy. From anywhere else the gateway returns 401 or 403.
- The gateway does not follow redirects; GitHub tarball URLs come back as a 302 with a signed `codeload` location.
- The Pinecone connector forwards data-plane routes only. Create indexes once, outside the Sprite.
- The Box connector can read, create and version files but cannot delete them or list versions.
- Restoring a checkpoint restarts the Sprite and kills sessions (about 3 s on a small overlay). The orchestrator therefore never restores its own Sprite.
- A worker's memory cap applies only after a restart, and exceeding it reboots the worker; a dropped exec is reported as `oom`.
- The HTTP exec endpoint has no frame lengths, so Doorman uses the SDK's WebSocket exec.

Details and measurements: [spikes.md](spikes.md).
