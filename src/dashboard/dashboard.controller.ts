import {
  Controller,
  Get,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import type { Request } from 'express';
import type { CognitoJwtPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';
import { DashboardSummaryDto } from './dto/dashboard-summary.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
  ) {}

  @Get('summary')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getSummary(
    @Req()
    request: Request & { user: CognitoJwtPayload },
  ): Promise<DashboardSummaryDto> {
    const cognitoId = request.user.sub;
    const user = await this.prisma.user.findUnique({
      where: { cognitoId },
      select: { tenantId: true, siteId: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const summary = await this.dashboardService.getSummary(
      user.tenantId,
      user.siteId,
    );

    return plainToInstance(DashboardSummaryDto, summary, {
      excludeExtraneousValues: true,
    });
  }
}

