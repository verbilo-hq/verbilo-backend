import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../config/env.schema';

export type CognitoJwtPayload = {
  sub: string;
  token_use?: 'id' | 'access';
  aud?: string;
  [claim: string]: unknown;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly expectedClientId: string;

  constructor(configService: ConfigService<Env, true>) {
    const awsRegion = configService.getOrThrow('AWS_REGION');
    const userPoolId = configService.getOrThrow('COGNITO_USER_POOL_ID');
    const expectedClientId = configService.getOrThrow('COGNITO_CLIENT_ID');

    const cognitoIssuer = `https://cognito-idp.${awsRegion}.amazonaws.com/${userPoolId}`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: cognitoIssuer,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${cognitoIssuer}/.well-known/jwks.json`,
      }),
    });

    this.expectedClientId = expectedClientId;
  }

  validate(payload: CognitoJwtPayload) {
    if (payload.token_use !== 'id') {
      this.logger.warn(
        `Rejecting JWT: unexpected token_use=${String(payload.token_use)}`,
      );
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.aud !== this.expectedClientId) {
      this.logger.warn(
        `Rejecting JWT: unexpected aud=${String(payload.aud)}`,
      );
      throw new UnauthorizedException('Invalid token');
    }

    return payload;
  }
}
