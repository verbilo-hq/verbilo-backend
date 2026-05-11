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

  // NOTE: Also consumed in `src/instrument.ts` before Nest boots.
  SENTRY_DSN: z.string().url().optional(),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.string().min(1).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;
