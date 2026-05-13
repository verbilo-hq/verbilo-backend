import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';
import type { Env } from '../../config/env.schema';

const requireFromHere = createRequire(__filename);

type S3ClientInstance = {
  send(command: unknown): Promise<unknown>;
};

type S3Sdk = {
  S3Client: new (input: {
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => S3ClientInstance;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
};

export type S3UploadResult =
  | { kind: 'uploaded'; url: string; key: string }
  | { kind: 's3-not-configured' };

export type S3DeleteResult =
  | { kind: 'deleted' }
  | { kind: 's3-not-configured' }
  | { kind: 'not-found' };

export class S3OperationError extends Error {
  constructor(message: string) {
    super(`S3 operation failed: ${message}`);
    this.name = 'S3OperationError';
  }
}

@Injectable()
export class S3Client {
  private readonly logger = new Logger(S3Client.name);
  private readonly bucket?: string;
  private readonly region?: string;
  private readonly client?: S3ClientInstance;
  private readonly PutObjectCommand?: S3Sdk['PutObjectCommand'];
  private readonly DeleteObjectCommand?: S3Sdk['DeleteObjectCommand'];

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_LOGOS_BUCKET', { infer: true });
    // VER-69 hotfix: bucket lives in eu-west-2 but AWS_REGION is
    // eu-north-1 (Cognito). Reading the wrong region made the SDK
    // sign requests against the wrong endpoint → PermanentRedirect
    // → 500 to the caller. S3_LOGOS_REGION defaults to eu-west-2 in
    // env.schema.ts so Render doesn't need to set it explicitly.
    this.region = config.get('S3_LOGOS_REGION', { infer: true });
    const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', {
      infer: true,
    });

    if (this.bucket && this.region && accessKeyId && secretAccessKey) {
      const sdk = this.loadSdk();
      if (!sdk) {
        return;
      }

      this.PutObjectCommand = sdk.PutObjectCommand;
      this.DeleteObjectCommand = sdk.DeleteObjectCommand;
      this.client = new sdk.S3Client({
        region: this.region,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  async uploadObject(opts: {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string;
  }): Promise<S3UploadResult> {
    if (
      !this.client ||
      !this.PutObjectCommand ||
      !this.bucket ||
      !this.region
    ) {
      this.logger.log(`Skipping S3 upload for ${opts.key}: s3-not-configured`);
      return { kind: 's3-not-configured' };
    }

    try {
      await this.client.send(
        new this.PutObjectCommand({
          Bucket: this.bucket,
          Key: opts.key,
          Body: opts.body,
          ContentType: opts.contentType,
          CacheControl: opts.cacheControl,
        }),
      );

      return {
        kind: 'uploaded',
        key: opts.key,
        url: this.publicUrlForKey(opts.key),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new S3OperationError(message);
    }
  }

  async deleteObject(opts: { key: string }): Promise<S3DeleteResult> {
    if (!this.client || !this.DeleteObjectCommand || !this.bucket) {
      this.logger.log(`Skipping S3 delete for ${opts.key}: s3-not-configured`);
      return { kind: 's3-not-configured' };
    }

    try {
      await this.client.send(
        new this.DeleteObjectCommand({
          Bucket: this.bucket,
          Key: opts.key,
        }),
      );

      return { kind: 'deleted' };
    } catch (error) {
      if (
        this.isS3Error(error, 'NoSuchKey') ||
        this.isS3Error(error, 'NotFound')
      ) {
        return { kind: 'not-found' };
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new S3OperationError(message);
    }
  }

  private publicUrlForKey(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private loadSdk(): S3Sdk | undefined {
    try {
      return requireFromHere('@aws-sdk/client-s3') as S3Sdk;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`Skipping S3 client setup: ${message}`);
      return undefined;
    }
  }

  private isS3Error(error: unknown, name: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === name
    );
  }
}
