import { z } from 'zod';

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const envSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  COOKIE_SECURE: z
    .enum(['true', 'false'], 'must be "true" or "false"')
    .default('false')
    .transform((v) => v === 'true'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ: z.string().refine(isTimeZone, 'must be an IANA time zone').default('America/New_York'),
  RXNAV_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('https://rxnav.nlm.nih.gov/REST'),
  OPENFDA_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('https://api.fda.gov/drug'),
  PUBMED_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('https://eutils.ncbi.nlm.nih.gov/entrez/eutils'),
  // Optional; raises NCBI's limit from 3 to 10 requests/s. Sent as a query parameter, never logged.
  NCBI_API_KEY: z.string().trim().min(1).optional(),
  // Optional contact address NCBI asks E-utilities clients to send (with tool=rxplus).
  NCBI_EMAIL: z.email('must be an email address').optional(),
  CTGOV_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('https://clinicaltrials.gov/api/v2'),
  COSTPLUS_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main'),
  MEDLINEPLUS_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('https://connect.medlineplus.gov/service'),
  // AI summaries: a local Ollama model by default, Claude optional.
  SUMMARY_PROVIDER: z.enum(['ollama', 'claude'], 'must be "ollama" or "claude"').default('ollama'),
  // Research and digest takeaways; defaults to SUMMARY_PROVIDER.
  TAKEAWAY_PROVIDER: z.enum(['ollama', 'claude'], 'must be "ollama" or "claude"').optional(),
  OLLAMA_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    // 127.0.0.1, not localhost: Node may resolve localhost to ::1 while Ollama listens on IPv4.
    .default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().trim().min(1).optional(),
  // Optional: the local model for research and digest takeaways (default OLLAMA_MODEL).
  OLLAMA_TAKEAWAY_MODEL: z.string().trim().min(1).optional(),
  // Optional: a (stronger) model that checks each takeaway against its quote. Off when unset.
  OLLAMA_CHECK_MODEL: z.string().trim().min(1).optional(),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(262144).default(16384),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(600_000),
  // Optional: TypeSafe's Jev decision model checks each local takeaway against its quote,
  // in place of OLLAMA_CHECK_MODEL. Off when unset. Never logged.
  JEV_API_KEY: z.string().trim().min(1).optional(),
  // Which service the key is for: TypeSafe's own API or the Vercel AI Gateway.
  JEV_PROVIDER: z
    .enum(['typesafe', 'gateway'], 'must be "typesafe" or "gateway"')
    .default('typesafe'),
  // Optional: overrides the service's default address.
  JEV_BASE_URL: z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' }).optional(),
  JEV_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(20),
  // Optional; raises openFDA's daily limit. Sent as a query parameter, never logged.
  OPENFDA_API_KEY: z.string().trim().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  override readonly name = 'EnvError';
}

/** Validates the environment. Error messages name variables but never echo their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.');
    const reason = issue.code === 'invalid_type' ? 'is required' : issue.message;
    return `  - ${key} ${reason}`;
  });
  throw new EnvError(`Invalid environment configuration:\n${problems.join('\n')}`);
}

/** Settings that used to exist and are now ignored, with why. */
export function ignoredSettings(source: Record<string, string | undefined>): string[] {
  return source['APP_PASSWORD_HASH']
    ? ['APP_PASSWORD_HASH is ignored: sign-in uses accounts now (npm run user -- add <name>).']
    : [];
}

let cached: Env | undefined;

/** Validated server environment, parsed once from process.env. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
