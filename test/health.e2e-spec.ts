import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/verbilo',
      COGNITO_USER_POOL_ID: 'eu-north-1_example',
      COGNITO_CLIENT_ID: 'example-client-id',
      FRONTEND_URL: 'http://localhost:5173',
      RENDER_GIT_COMMIT: 'commit123',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    jest.spyOn(process, 'uptime').mockReturnValue(42.2);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: jest.fn().mockResolvedValue(1),
        tenant: { findUnique: jest.fn() },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('GET /health returns ok when DB query succeeds', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({
        status: 'ok',
        uptime: 42,
        version: 'commit123',
        dbReachable: true,
      });
  });
});

