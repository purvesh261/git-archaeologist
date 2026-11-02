import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  // Optional so the CLI can enqueue jobs without it; only workers call GitHub.
  GITHUB_TOKEN: z.string().min(1).optional(),
  // Bare clones, one per repo id; only workers use it.
  GIT_DATA_DIR: z.string().min(1).default('.data/git'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return envSchema.parse(raw);
}
