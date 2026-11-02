import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  GIT_LOG_ARGS,
  parseCommitRecord,
  splitRecords,
  type CommitPayload,
} from './commits.parse.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ann Author',
  GIT_AUTHOR_EMAIL: 'ann@example.com',
  GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
  GIT_COMMITTER_NAME: 'Cy Committer',
  GIT_COMMITTER_EMAIL: 'cy@example.com',
  GIT_COMMITTER_DATE: '2026-01-03T03:04:05Z',
};

let dir: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    env: GIT_ENV,
    encoding: 'utf8',
  });
const commit = (message: string) => {
  git('commit', '-q', '--allow-empty', '--cleanup=verbatim', '-m', message);
  return git('rev-parse', 'HEAD').trim();
};
/** Runs the real GIT_LOG_ARGS and parses every record, newest first. */
const log = async () => {
  const out = execFileSync('git', GIT_LOG_ARGS, { cwd: dir });
  const items = [];
  for await (const r of splitRecords(Readable.from([out]))) items.push(parseCommitRecord(r));
  return items;
};
const payload = async (i = 0) => (await log())[i].payload as CommitPayload;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ga-log-'));
  git('init', '-q', '-b', 'main');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseCommitRecord', () => {
  it('parses a root commit with no parents', async () => {
    const sha = commit('root');

    const [item] = await log();

    expect(item).toMatchObject({ kind: 'commit', externalId: sha });
    expect(item.payload).toEqual({
      sha,
      parents: [],
      author: { name: 'Ann Author', email: 'ann@example.com', date: '2026-01-02T03:04:05Z' },
      committer: { name: 'Cy Committer', email: 'cy@example.com', date: '2026-01-03T03:04:05Z' },
      message: 'root\n',
      trailers: [],
    });
  });

  it('parses a merge commit with two parents', async () => {
    const base = commit('base');
    git('checkout', '-q', '-b', 'side');
    const side = commit('side');
    git('checkout', '-q', 'main');
    const main = commit('main');
    git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');

    expect((await payload()).parents).toEqual([main, side]);
    expect((await log()).map((i) => i.externalId)).toContain(base);
  });

  it('keeps the full message, and an empty trailers array when there are none', async () => {
    commit('subject line\n\nA body paragraph.\n\nAnother one.');

    expect(await payload()).toMatchObject({
      message: 'subject line\n\nA body paragraph.\n\nAnother one.\n',
      trailers: [],
    });
  });

  it('keeps repeated trailer keys in order', async () => {
    commit('fix\n\nReviewed-By: Ann <a@x>\nReviewed-By: Bob <b@x>\nPR-URL: https://x/1');

    expect((await payload()).trailers).toEqual([
      { key: 'Reviewed-By', value: 'Ann <a@x>' },
      { key: 'Reviewed-By', value: 'Bob <b@x>' },
      { key: 'PR-URL', value: 'https://x/1' },
    ]);
  });

  it('unfolds a multi-line trailer value', async () => {
    commit('fix\n\nFixes: the first part\n  and the second part\nRefs: #1');

    expect((await payload()).trailers).toEqual([
      { key: 'Fixes', value: 'the first part and the second part' },
      { key: 'Refs', value: '#1' },
    ]);
  });

  it('does not treat Key: value inside a body paragraph as a trailer', async () => {
    commit('fix\n\nNote: this is prose.\n\nRefs: #1');
    expect((await payload()).trailers).toEqual([{ key: 'Refs', value: '#1' }]);

    // a last paragraph that mixes prose with Key: value is not a trailer block
    commit('fix\n\nSee the docs for details.\nNote: this matters');
    expect((await payload()).trailers).toEqual([]);
  });
});

describe('splitRecords', () => {
  it('yields each commit once across chunk boundaries', async () => {
    commit('one ✓');
    commit('two');
    commit('three');
    const out = execFileSync('git', GIT_LOG_ARGS, { cwd: dir });
    // 1-byte chunks split records and the multi-byte ✓
    const chunks = [...out].map((b) => Buffer.from([b]));

    const records = [];
    for await (const r of splitRecords(Readable.from(chunks))) records.push(r);

    expect(records.map((r) => (parseCommitRecord(r).payload as CommitPayload).message)).toEqual([
      'three\n',
      'two\n',
      'one ✓\n',
    ]);
  });
});
