import { EnvSchema } from './env.schema';

describe('EnvSchema', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/verbilo',
    AWS_REGION: 'eu-north-1',
    COGNITO_USER_POOL_ID: 'eu-north-1_example',
    COGNITO_CLIENT_ID: 'example-client-id',
    FRONTEND_URL: 'http://localhost:5173',
  };

  it('parses a valid env object', () => {
    expect(() => EnvSchema.parse(validEnv)).not.toThrow();
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = validEnv;
    expect(() => EnvSchema.parse(rest)).toThrow();
  });

  it('throws when FRONTEND_URL is not a URL', () => {
    expect(() =>
      EnvSchema.parse({
        ...validEnv,
        FRONTEND_URL: 'not-a-url',
      }),
    ).toThrow();
  });

  it('coerces PORT from a string', () => {
    const parsed = EnvSchema.parse({
      ...validEnv,
      PORT: '4321',
    });

    expect(parsed.PORT).toBe(4321);
  });

  it('defaults NODE_ENV to development', () => {
    const { AWS_REGION, ...rest } = validEnv;
    const parsed = EnvSchema.parse(rest);

    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.AWS_REGION).toBe('eu-north-1');
  });

  it('defaults TENANT_BASE_DOMAIN to verbilo.co.uk', () => {
    const parsed = EnvSchema.parse(validEnv);
    expect(parsed.TENANT_BASE_DOMAIN).toBe('verbilo.co.uk');
  });

  it('requires VERCEL_PROJECT_ID when VERCEL_API_TOKEN is set', () => {
    expect(() =>
      EnvSchema.parse({
        ...validEnv,
        VERCEL_API_TOKEN: 'vercel-token',
      }),
    ).toThrow();
  });

  it('allows VERCEL_API_TOKEN when VERCEL_PROJECT_ID is also set', () => {
    const parsed = EnvSchema.parse({
      ...validEnv,
      VERCEL_API_TOKEN: 'vercel-token',
      VERCEL_PROJECT_ID: 'project-id',
    });

    expect(parsed.VERCEL_API_TOKEN).toBe('vercel-token');
    expect(parsed.VERCEL_PROJECT_ID).toBe('project-id');
  });

  it('allows AWS access keys when both are present', () => {
    const parsed = EnvSchema.parse({
      ...validEnv,
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    expect(parsed.AWS_ACCESS_KEY_ID).toBe('access-key-id');
    expect(parsed.AWS_SECRET_ACCESS_KEY).toBe('secret-access-key');
  });

  it('allows AWS access keys when both are absent', () => {
    const parsed = EnvSchema.parse(validEnv);

    expect(parsed.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(parsed.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('requires AWS_SECRET_ACCESS_KEY when AWS_ACCESS_KEY_ID is set', () => {
    expect(() =>
      EnvSchema.parse({
        ...validEnv,
        AWS_ACCESS_KEY_ID: 'access-key-id',
      }),
    ).toThrow();
  });

  it('requires AWS_ACCESS_KEY_ID when AWS_SECRET_ACCESS_KEY is set', () => {
    expect(() =>
      EnvSchema.parse({
        ...validEnv,
        AWS_SECRET_ACCESS_KEY: 'secret-access-key',
      }),
    ).toThrow();
  });
});
