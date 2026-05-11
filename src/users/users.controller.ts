import {
  Controller,
  Get,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { Request } from 'express';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { UserMeDto } from './dto/user-me.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getMe(
    @Req()
    request: Request & {
      user: CognitoJwtPayload;
      tenant?: TenantRequestContext;
    },
  ) {
    const cognitoId = request.user.sub;
    const user = await this.prisma.user.findFirst({
      where: {
        cognitoId,
        ...(request.tenant ? { tenantId: request.tenant.id } : {}),
      },
      include: { tenant: true, site: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return plainToInstance(UserMeDto, user, {
      excludeExtraneousValues: true,
    });
  }
}
