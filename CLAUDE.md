# Git Archaeologist

RAG system that answers "why is this code like this?" for GitHub repos by retrieving and citing the commits, PRs and issues where decisions were made. Full spec: `docs/PROJECT.md`. Read it before planning any milestone.

## Stack

- NestJS + TypeScript (strict mode)
- PostgreSQL with pgvector; full-text search via `tsvector`
- BullMQ + Redis for all ingestion jobs
- Vitest for tests (NestJS 12 default; ESM project)

## Current milestone

v0 — eval first. Do not build retrieval until the eval set exists and is committed.

## Working rules

- This is a learning project. I write the retrieval, ranking and evaluation code myself. You scaffold plumbing (modules, config, GitHub API client, BullMQ wiring, migrations) and review my code.
- Plan before code: propose the approach for a milestone and wait for my go-ahead.
- Work one milestone at a time. Do not jump ahead to later versions in the spec.
- Every table carries `repo_id`. No repo-specific logic anywhere.
- GitHub API calls go through one rate-limit-aware client with retries and backoff. Never call the API outside a BullMQ job.
- Every retrieval change must be measured: run the eval and commit the results file alongside the change.
- Never hardcode an embedding dimension without a comment naming the model it matches.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`. Enforced by a commitlint `commit-msg` hook (`commitlint.config.js`, installed by husky on `npm install`).

- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `perf`, `eval`
- `eval` is for committing eval datasets and results files, so the history of measurements is easy to find (`git log --grep '^eval'`).
- Scopes (optional): `github`, `queue`, `ingestion`, `db`, `config`, `cli`, `eval`, `retrieval`, `deps`
- Summary in the imperative, lowercase, no trailing period, under 72 characters. Explain the *why* in the body when it isn't obvious.
- Breaking changes: `!` after the type/scope, plus a `BREAKING CHANGE:` footer.
- No AI attribution: no `Co-Authored-By: Claude` or "Generated with Claude Code" lines in commits or PRs.

## Commands

<!-- Fill in once scaffolded -->
- `npm run start:dev`
- `npm test`
- `npm run eval` — runs the eval suite and writes results to `eval/results/`