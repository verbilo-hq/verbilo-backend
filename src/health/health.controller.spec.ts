import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.RENDER_GIT_COMMIT;
  });

  it('returns 200 payload when DB is reachable', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(1) };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'RENDER_GIT_COMMIT' ? 'commit123' : 'development',
      ),
    };

    jest.spyOn(process, 'uptime').mockReturnValue(12.4);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);

    await expect(controller.getHealth()).resolves.toEqual({
      status: 'ok',
      uptime: 12,
      version: 'commit123',
      dbReachable: true,
    });
  });

  it('throws 503 payload when DB is unreachable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('db')) };
    const configService = { get: jest.fn().mockReturnValue(undefined) };

    jest.spyOn(process, 'uptime').mockReturnValue(9.6);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);

    try {
      await controller.getHealth();
      throw new Error('Expected getHealth() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        status: 'error',
        uptime: 10,
        version: 'dev',
        dbReachable: false,
      });
    }
  });
});
