import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

const VERBILO_SUBDOMAIN_ORIGIN_PATTERN =
  /^https:\/\/[a-z0-9-]+\.verbilo\.co\.uk$/;
const STAGING_SUBDOMAIN_ORIGIN_PATTERN =
  /^https:\/\/[a-z0-9-]+\.staging\.verbilo\.co\.uk$/;

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, '');
}

function getCorsOrigins() {
  return [
    'http://localhost:5173',
    'https://verbilo.co.uk',
    'https://www.verbilo.co.uk',
    'https://staging.verbilo.co.uk',
    ...(process.env.FRONTEND_URL ?? '').split(','),
    ...(process.env.FRONTEND_URLS ?? '').split(','),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
}

function isAllowedCorsOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  return (
    getCorsOrigins().includes(normalizedOrigin) ||
    VERBILO_SUBDOMAIN_ORIGIN_PATTERN.test(normalizedOrigin) ||
    STAGING_SUBDOMAIN_ORIGIN_PATTERN.test(normalizedOrigin)
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin(origin: string | undefined, callback: CorsOriginCallback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
