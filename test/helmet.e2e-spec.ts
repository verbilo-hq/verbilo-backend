import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { App } from 'supertest/types';

@Controller()
class RootController {
  @Get()
  getRoot() {
    return { ok: true };
  }
}

@Module({
  controllers: [RootController],
})
class RootModule {}

describe('Helmet headers (e2e-ish)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RootModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(
      helmet({
        hsts: {
          maxAge: 31536000, // 1 year
          includeSubDomains: true,
          preload: true,
        },
        frameguard: { action: 'deny' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        contentSecurityPolicy: false,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets baseline hardening headers', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect(
        'strict-transport-security',
        'max-age=31536000; includeSubDomains; preload',
      )
      .expect('x-frame-options', 'DENY')
      .expect('x-content-type-options', 'nosniff')
      .expect('referrer-policy', 'strict-origin-when-cross-origin');
  });
});

