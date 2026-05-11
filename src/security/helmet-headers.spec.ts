import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import { IncomingMessage, ServerResponse } from 'http';
import { Duplex } from 'stream';

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

describe('Helmet middleware', () => {
  class MockSocket extends Duplex {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _read(_size: number) {
      this.push(null);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
      callback();
    }
  }

  let app: INestApplication;

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

  it('adds baseline hardening headers', async () => {
    const expressApp = app.getHttpAdapter().getInstance();
    const socket = new MockSocket();
    const req = new IncomingMessage(socket);
    req.method = 'GET';
    req.url = '/';
    req.headers = { host: 'localhost' };

    const res = new ServerResponse(req);
    res.assignSocket(socket);

    await new Promise<void>((resolve) => {
      res.on('finish', () => resolve());
      expressApp(req, res);
    });

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
    expect(res.getHeader('x-frame-options')).toBe('DENY');
    expect(res.getHeader('x-content-type-options')).toBe('nosniff');
    expect(res.getHeader('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });
});
