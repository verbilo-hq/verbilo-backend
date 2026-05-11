import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { DbUserRequestContext } from '../common/request-context';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CreateStaffMemberDto } from './dto/create-staff-member.dto';
import { StaffListQueryDto } from './dto/staff-list-query.dto';
import { StaffMemberDto } from './dto/staff-member.dto';
import { UpdateStaffMemberDto } from './dto/update-staff-member.dto';
import { StaffService } from './staff.service';

type StaffRequest = Request & {
  user: CognitoJwtPayload;
  dbUser?: DbUserRequestContext;
};

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('practice_manager', 'area_manager', 'company_admin', 'company_owner')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  async listStaff(
    @Query() query: StaffListQueryDto,
    @Req() request: StaffRequest,
  ) {
    const tenantId = request.dbUser?.tenantId;
    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const staff = await this.staffService.listStaffMembers(
      tenantId,
      query.siteId,
    );

    return plainToInstance(StaffMemberDto, staff, {
      excludeExtraneousValues: true,
    });
  }

  @Post()
  async createStaff(
    @Body() body: CreateStaffMemberDto,
    @Req() request: StaffRequest,
  ) {
    const tenantId = request.dbUser?.tenantId;
    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const staffMember = await this.staffService.createStaffMember(tenantId, body);

    return plainToInstance(StaffMemberDto, staffMember, {
      excludeExtraneousValues: true,
    });
  }

  @Get(':id')
  async getStaff(@Param('id') id: string, @Req() request: StaffRequest) {
    const tenantId = request.dbUser?.tenantId;
    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const staffMember = await this.staffService.getStaffMember(tenantId, id);

    return plainToInstance(StaffMemberDto, staffMember, {
      excludeExtraneousValues: true,
    });
  }

  @Patch(':id')
  async updateStaff(
    @Param('id') id: string,
    @Body() body: UpdateStaffMemberDto,
    @Req() request: StaffRequest,
  ) {
    const tenantId = request.dbUser?.tenantId;
    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const staffMember = await this.staffService.updateStaffMember(
      tenantId,
      id,
      body,
    );

    return plainToInstance(StaffMemberDto, staffMember, {
      excludeExtraneousValues: true,
    });
  }

  @Delete(':id')
  async deleteStaff(@Param('id') id: string, @Req() request: StaffRequest) {
    const tenantId = request.dbUser?.tenantId;
    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const staffMember = await this.staffService.archiveStaffMember(tenantId, id);

    return plainToInstance(StaffMemberDto, staffMember, {
      excludeExtraneousValues: true,
    });
  }
}

