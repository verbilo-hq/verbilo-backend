import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../config/env.schema';

export type CognitoJwtPayload = {
  sub: string;
  [claim: string]: unknown;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<Env, true>) {
    const awsRegion = configService.getOrThrow('AWS_REGION');
    const userPoolId = configService.getOrThrow('COGNITO_USER_POOL_ID');

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
  }

  validate(payload: CognitoJwtPayload) {
    return payload;
  }
}
