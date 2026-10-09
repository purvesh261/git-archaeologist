import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface Repo {
  id: number;
  owner: string;
  name: string;
}

@Injectable()
export class ReposService {
  constructor(private readonly db: DatabaseService) {}

  /** Registers a repo (idempotent). GitHub names are case-insensitive, so we store lowercase. */
  async upsert(owner: string, name: string): Promise<Repo> {
    const { rows } = await this.db.query<Repo>(
      `insert into repos (owner, name) values ($1, $2)
       on conflict (owner, name) do update set owner = excluded.owner
       returning id, owner, name`,
      [owner.toLowerCase(), name.toLowerCase()],
    );
    return rows[0];
  }

  async get(id: number): Promise<Repo> {
    const { rows } = await this.db.query<Repo>(
      'select id, owner, name from repos where id = $1',
      [id],
    );
    if (!rows[0]) throw new Error(`Repo ${id} not found`);
    return rows[0];
  }
}
