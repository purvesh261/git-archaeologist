import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg, { type QueryResult, type QueryResultRow } from 'pg';
import type { Env } from '../config/env.js';

// pg returns int8 (bigint) as a string to avoid precision loss. Our ids and
// token counts stay far below 2^53, so plain numbers are safe and simpler.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Queryable = {
  query<R extends QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
};

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new pg.Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
    });
  }

  query<T extends QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      // A failed rollback means a dead connection: keep the original error and
      // destroy the client instead of returning it to the pool.
      await client.query('rollback').catch((e: Error) => (broken = e));
      throw err;
    } finally {
      client.release(broken);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
