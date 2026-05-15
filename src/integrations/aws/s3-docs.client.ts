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
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
};

type S3PresignerSdk = {
  getSignedUrl: (
    client: S3ClientInstance,
    command: unknown,
    opts: { expiresIn: number },
  ) => Promise<string>;
};

export type S3UploadResult =
  | { kind: 'uploaded'; key: string }
  | { kind: 's3-not-configured' };

export type S3DeleteResult =
  | { kind: 'deleted' }
  | { kind: 's3-not-configured' }
  | { kind: 'not-found' };

export class S3DocsOperationError extends Error {
  constructor(message: string) {
    super(`S3 docs operation failed: ${message}`);
    this.name = 'S3DocsOperationError';
  }
}

@Injectable()
export class S3DocsClient {
  private readonly logger = new Logger(S3DocsClient.name);
  private readonly bucket?: string;
  private readonly client?: S3ClientInstance;
  private readonly PutObjectCommand?: S3Sdk['PutObjectCommand'];
  private readonly DeleteObjectCommand?: S3Sdk['DeleteObjectCommand'];
  private readonly GetObjectCommand?: S3Sdk['GetObjectCommand'];
  private readonly getSignedUrl?: S3PresignerSdk['getSignedUrl'];

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_DOCS_BUCKET', { infer: true });
    const region = config.get('S3_DOCS_REGION', { infer: true });
    const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', {
      infer: true,
    });

    if (this.bucket && region && accessKeyId && secretAccessKey) {
      const sdk = this.loadSdk();
      const presigner = this.loadPresigner();
      if (!sdk || !presigner) {
        return;
      }

      this.PutObjectCommand = sdk.PutObjectCommand;
      this.DeleteObjectCommand = sdk.DeleteObjectCommand;
      this.GetObjectCommand = sdk.GetObjectCommand;
      this.getSignedUrl = presigner.getSignedUrl;
      this.client = new sdk.S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  async uploadObject(opts: {
    key: string;
    body: Buffer;
    contentType: string;
    contentDisposition?: string;
  }): Promise<S3UploadResult> {
    if (!this.client || !this.PutObjectCommand || !this.bucket) {
      this.logger.log(`Skipping S3 docs upload for ${opts.key}: s3-not-configured`);
      return { kind: 's3-not-configured' };
    }

    try {
      await this.client.send(
        new this.PutObjectCommand({
          Bucket: this.bucket,
          Key: opts.key,
          Body: opts.body,
          ContentType: opts.contentType,
          ContentDisposition: opts.contentDisposition,
        }),
      );

      return { kind: 'uploaded', key: opts.key };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new S3DocsOperationError(message);
    }
  }

  async deleteObject(key: string): Promise<S3DeleteResult> {
    if (!this.client || !this.DeleteObjectCommand || !this.bucket) {
      this.logger.log(`Skipping S3 docs delete for ${key}: s3-not-configured`);
      return { kind: 's3-not-configured' };
    }

    try {
      await this.client.send(
        new this.DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
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
      throw new S3DocsOperationError(message);
    }
  }

  async getSignedDownloadUrl(
    key: string,
    opts: { fileName: string; expiresInSeconds?: number },
  ): Promise<string | null> {
    if (
      !this.client ||
      !this.GetObjectCommand ||
      !this.getSignedUrl ||
      !this.bucket
    ) {
      this.logger.log(`Skipping S3 docs signed URL for ${key}: s3-not-configured`);
      return null;
    }

    try {
      return await this.getSignedUrl(
        this.client,
        new this.GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${this.escapeFileName(opts.fileName)}"`,
        }),
        { expiresIn: opts.expiresInSeconds ?? 300 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new S3DocsOperationError(message);
    }
  }

  private loadSdk(): S3Sdk | undefined {
    try {
      return requireFromHere('@aws-sdk/client-s3') as S3Sdk;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`Skipping S3 docs client setup: ${message}`);
      return undefined;
    }
  }

  private loadPresigner(): S3PresignerSdk | undefined {
    try {
      return requireFromHere('@aws-sdk/s3-request-presigner') as S3PresignerSdk;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`Skipping S3 docs presigner setup: ${message}`);
      return undefined;
    }
  }

  private escapeFileName(fileName: string): string {
    return fileName
      .replace(/[\r\n]/g, '_')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
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
