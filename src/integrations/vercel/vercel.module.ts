import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VercelDomainsClient } from './vercel-domains.client';

@Module({
  imports: [ConfigModule],
  providers: [VercelDomainsClient],
  exports: [VercelDomainsClient],
})
export class VercelModule {}
