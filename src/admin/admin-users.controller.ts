import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { DbUserRequestContext } from '../common/request-context';
import { RequiresCapability } from '../common/requires-capability.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { AdminUsersService } from './admin-users.service';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';

type AdminRequest = Request & {
  user: CognitoJwtPayload;
  dbUser?: DbUserRequestContext;
};

@Controller('admin/tenants/:id/users')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Roles('verbilo_super_admin', 'verbilo_support')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @RequiresCapability(CAPABILITIES.USERS_LIST)
  listUsers(@Param('id') tenantId: string) {
    return this.adminUsers.listUsers(tenantId);
  }

  @Patch(':userId')
  @Roles('verbilo_super_admin')
  @RequiresCapability(CAPABILITIES.USERS_UPDATE_ROLE)
  updateUserRole(
    @Param('id') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: UpdateTenantUserDto,
    @Req() request: AdminRequest,
  ) {
    return this.adminUsers.updateUserRole(
      tenantId,
      userId,
      body.role,
      request.dbUser,
    );
  }

  @Post(':userId/disable')
  @HttpCode(204)
  @Roles('verbilo_super_admin')
  @RequiresCapability(CAPABILITIES.USERS_DISABLE)
  disableUser(
    @Param('id') tenantId: string,
    @Param('userId') userId: string,
    @Req() request: AdminRequest,
  ): Promise<void> {
    return this.adminUsers.disableUser(tenantId, userId, request.dbUser);
  }

  @Post(':userId/enable')
  @HttpCode(204)
  @Roles('verbilo_super_admin')
  @RequiresCapability(CAPABILITIES.USERS_DISABLE)
  enableUser(
    @Param('id') tenantId: string,
    @Param('userId') userId: string,
    @Req() request: AdminRequest,
  ): Promise<void> {
    return this.adminUsers.enableUser(tenantId, userId, request.dbUser);
  }
}
