import { ConfigService } from '@nestjs/config';
import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

type HealthResponse = {
  status: 'ok' | 'error';
  uptime: number;
  version: string;
  dbReachable: boolean;
};

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    const uptime = Math.round(process.uptime());
    const version =
      (this.configService.get('RENDER_GIT_COMMIT' as never) as
        | string
        | undefined) ?? 'dev';

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        uptime,
        version,
        dbReachable: true,
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        uptime,
        version,
        dbReachable: false,
      });
    }
  }
}
