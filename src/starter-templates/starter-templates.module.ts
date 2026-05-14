import { Module } from '@nestjs/common';
import { StarterTemplatesController } from './starter-templates.controller';
import { StarterTemplatesService } from './starter-templates.service';

@Module({
  controllers: [StarterTemplatesController],
  providers: [StarterTemplatesService],
  exports: [StarterTemplatesService],
})
export class StarterTemplatesModule {}
