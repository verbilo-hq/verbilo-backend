import { Module } from '@nestjs/common';
import { CognitoAdminClient } from './cognito-admin.client';
import { Route53DomainsClient } from './route53.client';

@Module({
  providers: [CognitoAdminClient, Route53DomainsClient],
  exports: [CognitoAdminClient, Route53DomainsClient],
})
export class AwsModule {}
