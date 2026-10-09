# Git Archaeologist

Answers "why is this code like this?" for GitHub repos by retrieving and citing the commits, PRs and issues where the decision was made.

## Setup

```sh
cp .env.example .env        # then set GITHUB_TOKEN
npm install
npm run db:up               # Postgres (pgvector) + Redis via docker compose
npm run migrate -- up
npm run build
```

## Running

```sh
npm run start:dev                       # worker: consumes BullMQ jobs
npm run cli -- repo:add nodejs/node     # register a repo, enqueue its stats job
npm test
```

## Layout

| Path | What |
| --- | --- |
| `src/core.module.ts` | Config, database, queue producer. Shared by every process. |
| `src/worker.module.ts` | Worker process. The only place `GithubModule` is imported, so GitHub is only called from jobs. |
| `src/github/` | The single rate-limit-aware GitHub client. |
| `src/ingestion/` | BullMQ job handlers. |
| `migrations/` | SQL migrations (node-pg-migrate). |
| `eval/datasets/`, `eval/results/` | Committed eval sets and results. |
