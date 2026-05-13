import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';
import type { Env } from '../../config/env.schema';

const requireFromHere = createRequire(__filename);

type AdminCreateUserInput = {
  username: string;
  email: string;
  temporaryPassword: string;
};

type CognitoAttribute = {
  Name?: string;
  Value?: string;
};

type CognitoAdminCreateUserResponse = {
  User?: {
    Attributes?: CognitoAttribute[];
  };
};

type CognitoIdentityProviderClientInstance = {
  send(command: unknown): Promise<CognitoAdminCreateUserResponse>;
};

type CognitoSdk = {
  CognitoIdentityProviderClient: new (input: {
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => CognitoIdentityProviderClientInstance;
  AdminCreateUserCommand: new (input: Record<string, unknown>) => unknown;
};

export type CognitoAdminCreateUserResult =
  | { status: 'created'; cognitoSub: string }
  | { status: 'skipped'; reason: 'cognito-not-configured' };

export class CognitoUserAlreadyExistsError extends Error {
  constructor(username: string) {
    super(`Cognito user already exists: ${username}`);
    this.name = 'CognitoUserAlreadyExistsError';
  }
}

export class CognitoOperationError extends Error {
  constructor(message: string) {
    super(`Cognito operation failed: ${message}`);
    this.name = 'CognitoOperationError';
  }
}

@Injectable()
export class CognitoAdminClient {
  private readonly logger = new Logger(CognitoAdminClient.name);
  private readonly userPoolId?: string;
  private readonly region?: string;
  private readonly client?: CognitoIdentityProviderClientInstance;
  private readonly AdminCreateUserCommand?: CognitoSdk['AdminCreateUserCommand'];

  constructor(config: ConfigService<Env, true>) {
    this.userPoolId = config.get('COGNITO_USER_POOL_ID', { infer: true });
    this.region = config.get('AWS_REGION', { infer: true });
    const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', {
      infer: true,
    });

    if (this.userPoolId && this.region && accessKeyId && secretAccessKey) {
      const sdk = this.loadSdk();
      if (!sdk) {
        return;
      }

      this.AdminCreateUserCommand = sdk.AdminCreateUserCommand;
      this.client = new sdk.CognitoIdentityProviderClient({
        region: this.region,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  async adminCreateUser(
    input: AdminCreateUserInput,
  ): Promise<CognitoAdminCreateUserResult> {
    if (
      !this.userPoolId ||
      !this.region ||
      !this.client ||
      !this.AdminCreateUserCommand
    ) {
      this.logger.log(
        `Skipping Cognito adminCreateUser for ${input.username}: cognito-not-configured`,
      );
      return { status: 'skipped', reason: 'cognito-not-configured' };
    }

    try {
      const response = await this.client.send(
        new this.AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: input.username,
          UserAttributes: [
            { Name: 'email', Value: input.email },
            { Name: 'email_verified', Value: 'true' },
          ],
          TemporaryPassword: input.temporaryPassword,
          MessageAction: 'SUPPRESS',
        }),
      );

      const cognitoSub = response.User?.Attributes?.find(
        (attribute) => attribute.Name === 'sub',
      )?.Value;

      if (!cognitoSub) {
        throw new CognitoOperationError('Cognito response did not include sub');
      }

      return { status: 'created', cognitoSub };
    } catch (error) {
      if (error instanceof CognitoOperationError) {
        throw error;
      }

      if (this.isCognitoError(error, 'UsernameExistsException')) {
        throw new CognitoUserAlreadyExistsError(input.username);
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new CognitoOperationError(message);
    }
  }

  private isCognitoError(error: unknown, name: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === name
    );
  }

  private loadSdk(): CognitoSdk | undefined {
    try {
      return requireFromHere(
        '@aws-sdk/client-cognito-identity-provider',
      ) as CognitoSdk;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`Skipping Cognito admin client setup: ${message}`);
      return undefined;
    }
  }
}
