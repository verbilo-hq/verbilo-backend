import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DbUserRequestContext } from '../common/request-context';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantsService } from './tenants.service';

type AdminRequest = Request & {
  user: CognitoJwtPayload;
  dbUser?: DbUserRequestContext;
};

@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('verbilo_super_admin', 'verbilo_support')
export class AdminTenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  createTenant(
    @Body() body: Record<string, unknown>,
    @Req() request: AdminRequest,
  ) {
    return this.tenantsService.createTenant(body, request.dbUser?.id);
  }

  @Get()
  listTenants() {
    return this.tenantsService.listTenants();
  }

  @Get('check-slug')
  checkSlug(@Query('slug') slug?: string) {
    return this.tenantsService.checkSlug(slug);
  }

  @Get(':id')
  getTenant(@Param('id') id: string) {
    return this.tenantsService.getTenant(id);
  }

  @Patch(':id')
  updateTenant(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AdminRequest,
  ) {
    return this.tenantsService.updateTenant(id, body, request.dbUser?.id);
  }
}
