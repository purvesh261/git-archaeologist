import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DatabaseService } from './database.service.js';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('DatabaseService.transaction (integration)', () => {
  const db = new DatabaseService({
    get: () => url,
  } as unknown as ConfigService<Env, true>);
  const owner = `test-tx-${process.pid}`;

  const countRepos = async (name: string) =>
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from repos where owner = $1 and name = $2',
        [owner, name],
      )
    ).rows[0].n;

  afterAll(async () => {
    await db.query('delete from repos where owner = $1', [owner]);
    await db.onModuleDestroy();
  });

  it('transaction commits on success and rolls back on throw', async () => {
    await expect(
      db.transaction(async (q) => {
        await q.query('insert into repos (owner, name) values ($1, $2)', [
          owner,
          'rolled-back',
        ]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await countRepos('rolled-back')).toBe(0);

    await expect(
      db.transaction(async (q) => {
        await q.query('insert into repos (owner, name) values ($1, $2)', [
          owner,
          'committed',
        ]);
        return 'ok';
      }),
    ).resolves.toBe('ok');
    expect(await countRepos('committed')).toBe(1);
  });
});
