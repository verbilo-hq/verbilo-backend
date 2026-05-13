import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
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
import {
  CognitoOperationError,
  CognitoUserAlreadyExistsError,
} from '../integrations/aws/cognito-admin.client';
import { AdminUsersService } from './admin-users.service';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';

type AdminRequest = Request & {
  user: CognitoJwtPayload;
  dbUser?: DbUserRequestContext;
};

@Controller('admin/tenants/:id/users')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Roles(
  'verbilo_super_admin',
  'verbilo_support',
  'company_owner',
  'company_admin',
  'area_manager',
  'practice_manager',
)
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @RequiresCapability(CAPABILITIES.USERS_LIST)
  listUsers(@Param('id') tenantId: string, @Req() request: AdminRequest) {
    return this.adminUsers.listUsers(tenantId, request.dbUser);
  }

  @Post()
  @RequiresCapability(CAPABILITIES.USERS_CREATE)
  async createTenantUser(
    @Param('id') tenantId: string,
    @Body() body: CreateTenantUserDto,
    @Req() request: AdminRequest,
  ) {
    try {
      return await this.adminUsers.createTenantUser(
        request.dbUser,
        tenantId,
        body,
      );
    } catch (error) {
      if (error instanceof CognitoUserAlreadyExistsError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof CognitoOperationError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  @Patch(':userId')
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
  @RequiresCapability(CAPABILITIES.USERS_DISABLE)
  enableUser(
    @Param('id') tenantId: string,
    @Param('userId') userId: string,
    @Req() request: AdminRequest,
  ): Promise<void> {
    return this.adminUsers.enableUser(tenantId, userId, request.dbUser);
  }

  @Post(':userId/sites/:siteId')
  @HttpCode(204)
  @RequiresCapability(CAPABILITIES.USERS_ASSIGN_SITE)
  assignUserSite(
    @Param('id') tenantId: string,
    @Param('userId') userId: string,
    @Param('siteId') siteId: string,
    @Req() request: AdminRequest,
  ): Promise<void> {
    return this.adminUsers.assignUserSite(
      tenantId,
      userId,
      siteId,
      request.dbUser,
    );
  }

  @Delete(':userId/sites/:siteId')
  @HttpCode(204)
  @RequiresCapability(CAPABILITIES.USERS_ASSIGN_SITE)
  unassignUserSite(
    @Param('id') tenantId: string,
    @Param('userId') userId: string,
    @Param('siteId') siteId: string,
    @Req() request: AdminRequest,
  ): Promise<void> {
    return this.adminUsers.unassignUserSite(
      tenantId,
      userId,
      siteId,
      request.dbUser,
    );
  }
}
