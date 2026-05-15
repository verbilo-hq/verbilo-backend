import { Module } from '@nestjs/common';
import { CapabilityGuard } from '../common/capability.guard';
import { RolesGuard } from '../common/roles.guard';
import { AwsModule } from '../integrations/aws/aws.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [AwsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, RolesGuard, CapabilityGuard],
})
export class DocumentsModule {}
