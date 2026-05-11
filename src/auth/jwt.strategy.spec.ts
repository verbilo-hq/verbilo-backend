import { Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CognitoJwtPayload } from './jwt.strategy';
import type { Env } from '../config/env.schema';

jest.mock('jwks-rsa', () => ({
  passportJwtSecret: jest.fn(() => jest.fn()),
}));

const { JwtStrategy } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./jwt.strategy') as typeof import('./jwt.strategy');

describe('JwtStrategy', () => {
  let configService: ConfigService<Env, true>;
  let strategy: InstanceType<typeof JwtStrategy>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    configService = {
      getOrThrow: jest.fn((key: string) => {
        switch (key) {
          case 'AWS_REGION':
            return 'eu-north-1';
          case 'COGNITO_USER_POOL_ID':
            return 'eu-north-1_example';
          case 'COGNITO_CLIENT_ID':
            return 'example-client-id';
          default:
            throw new Error(`Unexpected key: ${key}`);
        }
      }),
    } as unknown as ConfigService<Env, true>;

    strategy = new JwtStrategy(configService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts an ID token with matching aud', () => {
    const payload: CognitoJwtPayload = {
      sub: 'user-sub',
      token_use: 'id',
      aud: 'example-client-id',
    };

    expect(strategy.validate(payload)).toBe(payload);
  });

  it("rejects token_use === 'access'", () => {
    const payload: CognitoJwtPayload = {
      sub: 'user-sub',
      token_use: 'access',
      aud: 'example-client-id',
    };

    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it('rejects ID token when aud mismatches', () => {
    const payload: CognitoJwtPayload = {
      sub: 'user-sub',
      token_use: 'id',
      aud: 'other-client-id',
    };

    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it('rejects token when token_use is missing', () => {
    const payload: CognitoJwtPayload = {
      sub: 'user-sub',
      aud: 'example-client-id',
    };

    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });
});
