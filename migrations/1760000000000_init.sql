-- Up Migration
create extension if not exists vector;

create table repos (
  id               bigserial primary key,
  owner            text not null,
  name             text not null,
  -- null until strategy selection is measured (v4)
  strategy         text check (strategy in ('full-context', 'agentic', 'rag')),
  corpus_tokens    bigint,
  synced_until     timestamptz,            -- incremental sync cursor
  created_at       timestamptz not null default now(),
  unique (owner, name)
);

-- GitHub API payloads exactly as fetched. Derived tables (artifacts, chunks)
-- are built from here, so changing how we parse never forces a re-fetch.
create table raw_items (
  id               bigserial primary key,
  repo_id          bigint not null references repos(id) on delete cascade,
  kind             text not null,          -- repo | issue | pr | ...
  external_id      text not null,          -- number, sha, or a fixed key for kind=repo
  payload          jsonb not null,
  fetched_at       timestamptz not null default now(),
  unique (repo_id, kind, external_id)
);

-- Where each resumable job got to; a job that dies restarts from here.
create table sync_cursors (
  repo_id          bigint not null references repos(id) on delete cascade,
  job              text not null,
  cursor           text,
  updated_at       timestamptz not null default now(),
  primary key (repo_id, job)
);

-- Down Migration
drop table sync_cursors;
drop table raw_items;
drop table repos;
