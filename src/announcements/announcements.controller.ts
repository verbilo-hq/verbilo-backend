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
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { DbUserRequestContext } from '../common/request-context';
import { RequiresCapability } from '../common/requires-capability.decorator';
import { RolesGuard } from '../common/roles.guard';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { ListAnnouncementsDto } from './dto/list-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

type AnnouncementRequest = Request & {
  dbUser: DbUserRequestContext;
};

@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Post()
  @RequiresCapability(CAPABILITIES.ANNOUNCEMENTS_CREATE)
  create(
    @Body() body: CreateAnnouncementDto,
    @Req() request: AnnouncementRequest,
  ) {
    return this.announcements.create(body, request.dbUser);
  }

  @Get()
  @RequiresCapability(CAPABILITIES.ANNOUNCEMENTS_LIST)
  list(
    @Query() query: ListAnnouncementsDto,
    @Req() request: AnnouncementRequest,
  ) {
    return this.announcements.list(query, request.dbUser);
  }

  @Patch(':id')
  @RequiresCapability(CAPABILITIES.ANNOUNCEMENTS_CREATE)
  update(
    @Param('id') id: string,
    @Body() body: UpdateAnnouncementDto,
    @Req() request: AnnouncementRequest,
  ) {
    return this.announcements.update(id, body, request.dbUser);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresCapability(CAPABILITIES.ANNOUNCEMENTS_DELETE)
  softDelete(
    @Param('id') id: string,
    @Req() request: AnnouncementRequest,
  ): Promise<void> {
    return this.announcements.softDelete(id, request.dbUser);
  }
}
