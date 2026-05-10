import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

export type CognitoJwtPayload = {
  sub: string;
  [claim: string]: unknown;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const awsRegion = process.env.AWS_REGION;
    const userPoolId = process.env.COGNITO_USER_POOL_ID;

    if (!awsRegion || !userPoolId) {
      throw new Error(
        'AWS_REGION and COGNITO_USER_POOL_ID must be set for JWT validation',
      );
    }

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
