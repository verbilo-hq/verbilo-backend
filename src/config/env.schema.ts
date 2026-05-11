import { z } from 'zod';

const PostgresUrlSchema = z
  .string()
  .url()
  .refine(
    (value) =>
      value.startsWith('postgres://') || value.startsWith('postgresql://'),
    {
      message: 'DATABASE_URL must start with postgres:// or postgresql://',
    },
  );

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  });

export const EnvSchema = z.object({
  DATABASE_URL: PostgresUrlSchema,

  AWS_REGION: z.string().min(1).default('eu-north-1'),
  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),

  FRONTEND_URL: HttpUrlSchema,

  FRONTEND_URLS: z.string().optional(),

  // Base domain for tenant URLs. Drives both the URL returned in API responses
  // (`https://{slug}.{TENANT_BASE_DOMAIN}`) and the Vercel auto-provision
  // behaviour: when this is the staging subzone, auto-provision skips because
  // the wildcard cert already covers it. Default keeps prod behaviour for
  // non-Render callers (seeds, tests, local dev).
  TENANT_BASE_DOMAIN: z.string().min(1).default('verbilo.co.uk'),

  // Vercel REST API token, scoped to the verbilo-frontend project. When unset,
  // the Vercel client is a no-op (used by local dev and staging). When set,
  // VERCEL_PROJECT_ID must also be set.
  VERCEL_API_TOKEN: z.string().min(1).optional(),
  VERCEL_PROJECT_ID: z.string().min(1).optional(),

  // Optional — only needed if the project is owned by a Vercel team. For
  // personal accounts (current setup), leave unset.
  VERCEL_TEAM_ID: z.string().min(1).optional(),

  // NOTE: Also consumed in `src/instrument.ts` before Nest boots.
  SENTRY_DSN: z.string().url().optional(),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.string().min(1).default('development'),
}).refine((env) => !env.VERCEL_API_TOKEN || Boolean(env.VERCEL_PROJECT_ID), {
  message: 'VERCEL_PROJECT_ID must be set when VERCEL_API_TOKEN is set',
  path: ['VERCEL_PROJECT_ID'],
});

export type Env = z.infer<typeof EnvSchema>;
