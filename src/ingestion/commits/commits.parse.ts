import type { Readable } from 'node:stream';
import type { RawItem } from '../backfill.store.js';

const FIELD_SEP = '\x1f';
// Git parses the trailers itself (interpret-trailers rules), so folded values and
// prose that merely looks like `Key: value` are handled exactly as git does.
const FIELDS = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%B', '%(trailers:only,unfold)'];

/** `git log` over the default branch: one NUL-terminated record per commit. */
export const GIT_LOG_ARGS = ['log', '-z', `--format=${FIELDS.join('%x1f')}`, 'HEAD'];

export interface CommitPayload {
  sha: string;
  parents: string[];
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
  message: string;
  trailers: { key: string; value: string }[];
}

export function parseCommitRecord(record: string): RawItem {
  const parts = record.split(FIELD_SEP);
  if (parts.length < FIELDS.length) {
    throw new Error(`Malformed git log record: ${record.slice(0, 80)}`);
  }
  const [sha, parents, an, ae, aI, cn, ce, cI] = parts;
  const trailerText = parts.at(-1)!;
  const payload: CommitPayload = {
    sha,
    parents: parents ? parents.split(' ') : [],
    author: { name: an, email: ae, date: aI },
    committer: { name: cn, email: ce, date: cI },
    // Rejoin in case a message itself contains the separator.
    message: parts.slice(8, -1).join(FIELD_SEP),
    trailers: trailerText
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf(':');
        return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
      }),
  };
  return { kind: 'commit', externalId: sha, payload };
}

/** Splits a NUL-delimited stream into records, decoding UTF-8 across chunk boundaries. */
export async function* splitRecords(stream: Readable): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += decoder.decode(chunk as Buffer, { stream: true });
    let nul: number;
    while ((nul = buf.indexOf('\0')) !== -1) {
      yield buf.slice(0, nul);
      buf = buf.slice(nul + 1);
    }
  }
  buf += decoder.decode();
  if (buf) yield buf;
}
