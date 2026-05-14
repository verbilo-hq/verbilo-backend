import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CapabilityGuard } from '../common/capability.guard';
import { RolesGuard } from '../common/roles.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [AuditModule, AuthModule, PrismaModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, RolesGuard, CapabilityGuard],
})
export class OnboardingModule {}
