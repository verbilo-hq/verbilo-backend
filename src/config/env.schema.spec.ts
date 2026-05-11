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
});

