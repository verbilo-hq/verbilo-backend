import './instrument';

import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

const VERBILO_SUBDOMAIN_ORIGIN_PATTERN =
  /^https:\/\/[a-z0-9-]+\.verbilo\.co\.uk$/;
const STAGING_SUBDOMAIN_ORIGIN_PATTERN =
  /^https:\/\/[a-z0-9-]+\.staging\.verbilo\.co\.uk$/;

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, '');
}

function getCorsOrigins(frontendUrl: string, frontendUrls?: string) {
  return [
    'http://localhost:5173',
    'https://verbilo.co.uk',
    'https://www.verbilo.co.uk',
    'https://staging.verbilo.co.uk',
    ...frontendUrl.split(','),
    ...(frontendUrls ?? '').split(','),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
}

function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  return (
    allowedOrigins.includes(normalizedOrigin) ||
    VERBILO_SUBDOMAIN_ORIGIN_PATTERN.test(normalizedOrigin) ||
    STAGING_SUBDOMAIN_ORIGIN_PATTERN.test(normalizedOrigin)
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<Env, true>);
  const corsOrigins = getCorsOrigins(
    configService.getOrThrow('FRONTEND_URL'),
    configService.get('FRONTEND_URLS'),
  );

  if (configService.get('SENTRY_DSN')) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SentryGlobalFilter } = require('@sentry/nestjs/setup');
    app.useGlobalFilters(new SentryGlobalFilter(app.get(HttpAdapterHost)));
  }

  app.use(
    helmet({
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Disable Helmet's own CSP — the frontend ships CSP via vercel.json
      // (VER-21 will land that), and Render returns JSON not HTML so the
      // backend's response CSP doesn't help us.
      contentSecurityPolicy: false,
    }),
  );

  app.enableCors({
    origin(origin: string | undefined, callback: CorsOriginCallback) {
      callback(null, isAllowedCorsOrigin(origin, corsOrigins));
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );
  await app.listen(configService.getOrThrow('PORT'));
}
void bootstrap();
