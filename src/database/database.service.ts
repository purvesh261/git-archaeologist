import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg, { type QueryResult, type QueryResultRow } from 'pg';
import type { Env } from '../config/env.js';

// pg returns int8 (bigint) as a string to avoid precision loss. Our ids and
// token counts stay far below 2^53, so plain numbers are safe and simpler.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

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

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
