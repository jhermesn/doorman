# Contributing

Thanks for helping. Read [AGENTS.md](AGENTS.md) first; it points to the docs that apply to your change.

```bash
npm ci
npm run check
```

- One logical change per pull request, with tests.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` …) and explain why.
- Anything that runs commands, builds prompts or touches workers needs a test for the hostile case too.
- Don't commit real credentials, even revoked ones. Build fake values at runtime in tests.
