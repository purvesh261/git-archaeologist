// Commit convention: see "Commits" in CLAUDE.md.
const AI_ATTRIBUTION = /co-authored-by:.*(claude|anthropic)|generated with \[?claude/i;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => [
          !AI_ATTRIBUTION.test(raw ?? ''),
          'remove the AI attribution line (Co-Authored-By: Claude / Generated with Claude Code)',
        ],
      },
    },
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'build', 'perf', 'eval'],
    ],
    // Warn rather than fail, so a genuinely new area can get a scope; add it here after.
    'scope-enum': [
      1,
      'always',
      ['github', 'queue', 'ingestion', 'db', 'config', 'cli', 'eval', 'retrieval', 'deps'],
    ],
    'header-max-length': [2, 'always', 72],
    'subject-case': [2, 'always', 'lower-case'],
    'no-ai-attribution': [2, 'always'],
  },
};
