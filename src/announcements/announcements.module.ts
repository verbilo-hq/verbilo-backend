import { Module } from '@nestjs/common';
import { CapabilityGuard } from '../common/capability.guard';
import { RolesGuard } from '../common/roles.guard';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, RolesGuard, CapabilityGuard],
})
export class AnnouncementsModule {}
