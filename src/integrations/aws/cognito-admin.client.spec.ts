import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  CognitoAdminClient,
  CognitoOperationError,
  CognitoUserAlreadyExistsError,
  CognitoUserNotFoundError,
} from './cognito-admin.client';

const mockSend = jest.fn();
const mockCognitoIdentityProviderClient = jest.fn(() => ({ send: mockSend }));
const mockAdminCreateUserCommand = jest.fn((input: unknown) => ({ input }));
const mockAdminDisableUserCommand = jest.fn((input: unknown) => ({ input }));
const mockAdminEnableUserCommand = jest.fn((input: unknown) => ({ input }));
const mockAdminDeleteUserCommand = jest.fn((input: unknown) => ({ input }));

jest.mock(
  '@aws-sdk/client-cognito-identity-provider',
  () => ({
    CognitoIdentityProviderClient: mockCognitoIdentityProviderClient,
    AdminCreateUserCommand: mockAdminCreateUserCommand,
    AdminDisableUserCommand: mockAdminDisableUserCommand,
    AdminEnableUserCommand: mockAdminEnableUserCommand,
    AdminDeleteUserCommand: mockAdminDeleteUserCommand,
  }),
  { virtual: true },
);

describe('CognitoAdminClient', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCognitoIdentityProviderClient.mockClear();
    mockAdminCreateUserCommand.mockClear();
    mockAdminDisableUserCommand.mockClear();
    mockAdminEnableUserCommand.mockClear();
    mockAdminDeleteUserCommand.mockClear();
  });

  function createClient(env: Partial<Env>) {
    const configService = {
      get: (key: string) => (env as Record<string, unknown>)[key],
    } as unknown as ConfigService<Env, true>;

    return new CognitoAdminClient(configService);
  }

  it.each([
    ['user pool id', { AWS_REGION: 'eu-north-1' }],
    ['region', { COGNITO_USER_POOL_ID: 'pool-id' }],
    [
      'access key',
      {
        COGNITO_USER_POOL_ID: 'pool-id',
        AWS_REGION: 'eu-north-1',
        AWS_SECRET_ACCESS_KEY: 'secret-key',
      },
    ],
    [
      'secret key',
      {
        COGNITO_USER_POOL_ID: 'pool-id',
        AWS_REGION: 'eu-north-1',
        AWS_ACCESS_KEY_ID: 'access-key',
      },
    ],
  ])('returns cognito-not-configured when %s is unset', async (_label, env) => {
    const client = createClient(env);

    await expect(
      client.adminCreateUser({
        username: 's.jenkins',
        email: 's.jenkins@example.com',
        temporaryPassword: 'TempPass1!',
      }),
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'cognito-not-configured',
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAdminCreateUserCommand).not.toHaveBeenCalled();
  });

  it('creates a Cognito user with suppressed invite email and returns sub', async () => {
    const client = createClient({
      COGNITO_USER_POOL_ID: 'pool-id',
      AWS_REGION: 'eu-north-1',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    mockSend.mockResolvedValue({
      User: { Attributes: [{ Name: 'sub', Value: 'cognito-sub' }] },
    });

    await expect(
      client.adminCreateUser({
        username: 's.jenkins',
        email: 's.jenkins@example.com',
        temporaryPassword: 'TempPass1!',
      }),
    ).resolves.toEqual({ status: 'created', cognitoSub: 'cognito-sub' });

    expect(mockCognitoIdentityProviderClient).toHaveBeenCalledWith({
      region: 'eu-north-1',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
    });
    expect(mockAdminCreateUserCommand).toHaveBeenCalledWith({
      UserPoolId: 'pool-id',
      Username: 's.jenkins',
      UserAttributes: [
        { Name: 'email', Value: 's.jenkins@example.com' },
        { Name: 'email_verified', Value: 'true' },
      ],
      TemporaryPassword: 'TempPass1!',
      MessageAction: 'SUPPRESS',
    });
    expect(mockSend).toHaveBeenCalledWith({
      input: {
        UserPoolId: 'pool-id',
        Username: 's.jenkins',
        UserAttributes: [
          { Name: 'email', Value: 's.jenkins@example.com' },
          { Name: 'email_verified', Value: 'true' },
        ],
        TemporaryPassword: 'TempPass1!',
        MessageAction: 'SUPPRESS',
      },
    });
  });

  it('maps UsernameExistsException to CognitoUserAlreadyExistsError', async () => {
    const client = createClient({
      COGNITO_USER_POOL_ID: 'pool-id',
      AWS_REGION: 'eu-north-1',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    mockSend.mockRejectedValue({ name: 'UsernameExistsException' });

    await expect(
      client.adminCreateUser({
        username: 's.jenkins',
        email: 's.jenkins@example.com',
        temporaryPassword: 'TempPass1!',
      }),
    ).rejects.toBeInstanceOf(CognitoUserAlreadyExistsError);
  });

  it('wraps other Cognito errors with their original message', async () => {
    const client = createClient({
      COGNITO_USER_POOL_ID: 'pool-id',
      AWS_REGION: 'eu-north-1',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    mockSend.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(
      client.adminCreateUser({
        username: 's.jenkins',
        email: 's.jenkins@example.com',
        temporaryPassword: 'TempPass1!',
      }),
    ).rejects.toThrow('Cognito operation failed: AccessDeniedException');
  });

  it('throws CognitoOperationError when Cognito omits the sub attribute', async () => {
    const client = createClient({
      COGNITO_USER_POOL_ID: 'pool-id',
      AWS_REGION: 'eu-north-1',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    mockSend.mockResolvedValue({ User: { Attributes: [] } });

    await expect(
      client.adminCreateUser({
        username: 's.jenkins',
        email: 's.jenkins@example.com',
        temporaryPassword: 'TempPass1!',
      }),
    ).rejects.toBeInstanceOf(CognitoOperationError);
  });

  it.each([
    ['disable', 'adminDisableUser', mockAdminDisableUserCommand],
    ['enable', 'adminEnableUser', mockAdminEnableUserCommand],
    ['delete', 'adminDeleteUser', mockAdminDeleteUserCommand],
  ] as const)(
    'calls Admin%sUserCommand by username',
    async (_label, method, command) => {
      const client = createClient({
        COGNITO_USER_POOL_ID: 'pool-id',
        AWS_REGION: 'eu-north-1',
        AWS_ACCESS_KEY_ID: 'access-key',
        AWS_SECRET_ACCESS_KEY: 'secret-key',
      });

      mockSend.mockResolvedValue({});

      await expect(client[method]('s.jenkins')).resolves.toBeUndefined();

      expect(command).toHaveBeenCalledWith({
        UserPoolId: 'pool-id',
        Username: 's.jenkins',
      });
      expect(mockSend).toHaveBeenCalledWith({
        input: {
          UserPoolId: 'pool-id',
          Username: 's.jenkins',
        },
      });
    },
  );

  it.each([
    ['disable', 'adminDisableUser'],
    ['enable', 'adminEnableUser'],
    ['delete', 'adminDeleteUser'],
  ] as const)(
    'maps Admin%sUser UserNotFoundException',
    async (_label, method) => {
      const client = createClient({
        COGNITO_USER_POOL_ID: 'pool-id',
        AWS_REGION: 'eu-north-1',
        AWS_ACCESS_KEY_ID: 'access-key',
        AWS_SECRET_ACCESS_KEY: 'secret-key',
      });

      mockSend.mockRejectedValue({ name: 'UserNotFoundException' });

      await expect(client[method]('s.jenkins')).rejects.toBeInstanceOf(
        CognitoUserNotFoundError,
      );
    },
  );
});
