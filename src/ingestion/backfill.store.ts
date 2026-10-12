import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type Queryable,
} from '../database/database.service.js';

export interface RawItem {
  kind: string;
  externalId: string;
  payload: unknown;
}

export interface CursorState {
  cursor: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** raw_items + sync_cursors for resumable backfills: a page and its cursor commit together. */
@Injectable()
export class BackfillStore {
  constructor(private readonly db: DatabaseService) {}

  async getCursor(repoId: number, job: string): Promise<CursorState | null> {
    const { rows } = await this.db.query<CursorState>(
      `select cursor, started_at as "startedAt", completed_at as "completedAt"
       from sync_cursors where repo_id = $1 and job = $2`,
      [repoId, job],
    );
    return rows[0] ?? null;
  }

  savePage(
    repoId: number,
    job: string,
    items: RawItem[],
    next: { cursor: string | null; done: boolean },
  ): Promise<void> {
    return this.db.transaction(async (q) => {
      await upsertItems(q, repoId, items);
      await q.query(
        `insert into sync_cursors (repo_id, job, cursor, started_at, completed_at)
         values ($1, $2, $3, now(), case when $4 then now() end)
         on conflict (repo_id, job) do update set
           cursor = excluded.cursor,
           started_at = coalesce(sync_cursors.started_at, excluded.started_at),
           completed_at = excluded.completed_at,
           updated_at = now()`,
        [repoId, job, next.cursor, next.done],
      );
    });
  }

  saveItems(repoId: number, items: RawItem[]): Promise<void> {
    return upsertItems(this.db, repoId, items);
  }

  async reset(repoId: number, job: string): Promise<void> {
    await this.db.query(
      'delete from sync_cursors where repo_id = $1 and job = $2',
      [repoId, job],
    );
  }
}

async function upsertItems(
  q: Queryable,
  repoId: number,
  items: RawItem[],
): Promise<void> {
  if (items.length === 0) return;
  await q.query(
    `insert into raw_items (repo_id, kind, external_id, payload)
     select $1, * from unnest($2::text[], $3::text[], $4::jsonb[])
     on conflict (repo_id, kind, external_id)
     do update set payload = excluded.payload, fetched_at = now()`,
    [
      repoId,
      items.map((i) => i.kind),
      items.map((i) => i.externalId),
      items.map((i) => JSON.stringify(i.payload)),
    ],
  );
}
