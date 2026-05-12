import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { Request } from 'express';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { SkipAuditLog } from '../common/skip-audit-log.decorator';
import {
  DbUserRequestContext,
  TenantRequestContext,
} from '../common/request-context';
import { USER_ROLES } from '../common/user-roles';
import { UserMeDto } from './dto/user-me.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
    const user = await this.usersService.getMe(
      cognitoId,
      request.tenant?.id,
    );

    return plainToInstance(UserMeDto, user, {
      excludeExtraneousValues: true,
    });
  }

  @Get('me/permissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...USER_ROLES)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getMyPermissions(
    @Req()
    request: Request & {
      dbUser: DbUserRequestContext;
    },
  ) {
    return this.usersService.getMyPermissions(request.dbUser);
  }

  @Get('me/export')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async exportMe(
    @Req()
    request: Request & {
      user: CognitoJwtPayload;
      tenant?: TenantRequestContext;
    },
  ) {
    const cognitoId = request.user.sub;
    return this.usersService.exportMyData(cognitoId, request.tenant?.id);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @SkipAuditLog()
  @HttpCode(204)
  async deleteMe(
    @Req()
    request: Request & {
      user: CognitoJwtPayload;
      tenant?: TenantRequestContext;
    },
  ) {
    const cognitoId = request.user.sub;
    await this.usersService.deleteMyData(cognitoId, request.tenant?.id);
  }
}
