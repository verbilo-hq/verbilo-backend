import { Module } from '@nestjs/common';
import { CognitoAdminClient } from './cognito-admin.client';
import { Route53DomainsClient } from './route53.client';
import { S3Client } from './s3.client';
import { S3DocsClient } from './s3-docs.client';

@Module({
  providers: [CognitoAdminClient, Route53DomainsClient, S3Client, S3DocsClient],
  exports: [CognitoAdminClient, Route53DomainsClient, S3Client, S3DocsClient],
})
export class AwsModule {}
