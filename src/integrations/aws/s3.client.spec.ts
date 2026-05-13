import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { S3Client, S3OperationError } from './s3.client';

const mockSend = jest.fn();
const mockAwsS3Client = jest.fn(() => ({ send: mockSend }));
const mockPutObjectCommand = jest.fn((input: unknown) => ({ input }));
const mockDeleteObjectCommand = jest.fn((input: unknown) => ({ input }));

jest.mock(
  '@aws-sdk/client-s3',
  () => ({
    S3Client: mockAwsS3Client,
    PutObjectCommand: mockPutObjectCommand,
    DeleteObjectCommand: mockDeleteObjectCommand,
  }),
  { virtual: true },
);

describe('S3Client', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockAwsS3Client.mockClear();
    mockPutObjectCommand.mockClear();
    mockDeleteObjectCommand.mockClear();
  });

  function createClient(env: Partial<Env>) {
    const configService = {
      get: (key: string) => (env as Record<string, unknown>)[key],
    } as unknown as ConfigService<Env, true>;

    return new S3Client(configService);
  }

  it('uploads an object and returns the public URL', async () => {
    const client = createClient({
      S3_LOGOS_BUCKET: 'verbilo-tenant-logos',
      AWS_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });
    const body = Buffer.from('png');

    mockSend.mockResolvedValue({});

    await expect(
      client.uploadObject({
        key: 'tenants/tenant-id/logo-123.png',
        body,
        contentType: 'image/png',
        cacheControl: 'public, max-age=86400',
      }),
    ).resolves.toEqual({
      kind: 'uploaded',
      key: 'tenants/tenant-id/logo-123.png',
      url: 'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-123.png',
    });

    expect(mockAwsS3Client).toHaveBeenCalledWith({
      region: 'eu-west-2',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
    });
    expect(mockPutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'verbilo-tenant-logos',
      Key: 'tenants/tenant-id/logo-123.png',
      Body: body,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=86400',
    });
    expect(mockSend).toHaveBeenCalledWith({
      input: {
        Bucket: 'verbilo-tenant-logos',
        Key: 'tenants/tenant-id/logo-123.png',
        Body: body,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=86400',
      },
    });
  });

  it('skips uploads when the logos bucket is unset', async () => {
    const client = createClient({
      AWS_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    await expect(
      client.uploadObject({
        key: 'tenants/tenant-id/logo-123.png',
        body: Buffer.from('png'),
        contentType: 'image/png',
      }),
    ).resolves.toEqual({ kind: 's3-not-configured' });

    expect(mockAwsS3Client).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockPutObjectCommand).not.toHaveBeenCalled();
  });

  it('wraps upload errors as S3OperationError', async () => {
    const client = createClient({
      S3_LOGOS_BUCKET: 'verbilo-tenant-logos',
      AWS_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    mockSend.mockRejectedValue(new Error('AccessDenied'));

    await expect(
      client.uploadObject({
        key: 'tenants/tenant-id/logo-123.png',
        body: Buffer.from('png'),
        contentType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(S3OperationError);
  });

  it('deletes an object when configured', async () => {
    const client = createClient({
      S3_LOGOS_BUCKET: 'verbilo-tenant-logos',
      AWS_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    mockSend.mockResolvedValue({});

    await expect(
      client.deleteObject({ key: 'tenants/tenant-id/logo-123.png' }),
    ).resolves.toEqual({ kind: 'deleted' });

    expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'verbilo-tenant-logos',
      Key: 'tenants/tenant-id/logo-123.png',
    });
  });

  it('maps missing S3 keys to not-found', async () => {
    const client = createClient({
      S3_LOGOS_BUCKET: 'verbilo-tenant-logos',
      AWS_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    });

    mockSend.mockRejectedValue({ name: 'NoSuchKey' });

    await expect(
      client.deleteObject({ key: 'tenants/tenant-id/logo-123.png' }),
    ).resolves.toEqual({ kind: 'not-found' });
  });
});
