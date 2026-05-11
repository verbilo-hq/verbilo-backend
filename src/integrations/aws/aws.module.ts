import { Module } from '@nestjs/common';
import { Route53DomainsClient } from './route53.client';

@Module({
  providers: [Route53DomainsClient],
  exports: [Route53DomainsClient],
})
export class AwsModule {}
