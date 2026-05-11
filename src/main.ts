import './instrument';

import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
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

  app.enableCors({
    origin(origin: string | undefined, callback: CorsOriginCallback) {
      callback(null, isAllowedCorsOrigin(origin, corsOrigins));
    },
  });
  await app.listen(configService.getOrThrow('PORT'));
}
void bootstrap();
