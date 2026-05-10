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
    ...(process.env.FRONTEND_URL ?? '').split(','),
    ...(process.env.FRONTEND_URLS ?? '').split(','),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: getCorsOrigins(),
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
