import { Module } from '@nestjs/common';
import { CognitoAdminClient } from './cognito-admin.client';
import { Route53DomainsClient } from './route53.client';
import { S3Client } from './s3.client';

@Module({
  providers: [CognitoAdminClient, Route53DomainsClient, S3Client],
  exports: [CognitoAdminClient, Route53DomainsClient, S3Client],
})
export class AwsModule {}
