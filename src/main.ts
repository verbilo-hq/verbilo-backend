import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigins = getCorsOrigins();
  const prodTenantOriginRegex = /^https:\/\/[a-z0-9-]+\.verbilo\.co\.uk$/;
  const stagingTenantOriginRegex = /^https:\/\/[a-z0-9-]+\.staging\.verbilo\.co\.uk$/;
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);
      const isAllowed =
        corsOrigins.includes(normalizedOrigin) ||
        prodTenantOriginRegex.test(normalizedOrigin) ||
        stagingTenantOriginRegex.test(normalizedOrigin);

      callback(isAllowed ? null : new Error('Not allowed by CORS'), isAllowed);
    },
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
