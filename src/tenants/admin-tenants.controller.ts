import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { DbUserRequestContext } from '../common/request-context';
import { RequiresCapability } from '../common/requires-capability.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantSlugQueryDto } from './dto/tenant-slug.dto';
import { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsService, type TenantLogoUploadFile } from './tenants.service';

type AdminRequest = Request & {
  user: CognitoJwtPayload;
  dbUser?: DbUserRequestContext;
};

@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Roles('verbilo_super_admin', 'verbilo_support')
export class AdminTenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @RequiresCapability(CAPABILITIES.TENANT_CREATE)
  createTenant(@Body() body: CreateTenantDto, @Req() request: AdminRequest) {
    return this.tenantsService.createTenant(body, request.dbUser);
  }

  @Get()
  listTenants() {
    return this.tenantsService.listTenants();
  }

  @Get('check-slug')
  checkSlug(@Query() query: TenantSlugQueryDto) {
    return this.tenantsService.checkSlug(query.slug);
  }

  @Get(':id')
  getTenant(@Param('id') id: string) {
    return this.tenantsService.getTenant(id);
  }

  @Patch(':id')
  @RequiresCapability(CAPABILITIES.TENANT_UPDATE)
  updateTenant(
    @Param('id') id: string,
    @Body() body: UpdateTenantDto,
    @Req() request: AdminRequest,
  ) {
    return this.tenantsService.updateTenant(id, body, request.dbUser);
  }

  @Patch(':id/branding')
  @RequiresCapability(CAPABILITIES.TENANT_UPDATE_BRANDING)
  @Roles(
    'verbilo_super_admin',
    'verbilo_support',
    'company_owner',
    'company_admin',
  )
  updateBranding(
    @Param('id') id: string,
    @Body() body: UpdateTenantBrandingDto,
    @Req() request: AdminRequest,
  ) {
    return this.tenantsService.updateBranding(id, body, request.dbUser);
  }

  @Post(':id/branding/logo')
  @RequiresCapability(CAPABILITIES.TENANT_UPDATE_BRANDING)
  @Roles(
    'verbilo_super_admin',
    'verbilo_support',
    'company_owner',
    'company_admin',
  )
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(
    @Param('id') id: string,
    @UploadedFile() file: TenantLogoUploadFile | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.tenantsService.uploadLogo(id, file, request.dbUser);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('verbilo_super_admin')
  @RequiresCapability(CAPABILITIES.TENANT_DELETE)
  deleteTenant(
    @Param('id') id: string,
    @Req() request: AdminRequest,
  ): Promise<void> {
    return this.tenantsService.deleteTenant(id, request.dbUser);
  }
}
