import {
  ForbiddenException,
  PayloadTooLargeException,
  RequestMethod,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';
import { REQUIRES_CAPABILITY_KEY } from '../common/requires-capability.decorator';
import type { Route53DomainsClient } from '../integrations/aws/route53.client';
import type { S3Client } from '../integrations/aws/s3.client';
import type { VercelDomainsClient } from '../integrations/vercel/vercel-domains.client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminTenantsController } from './admin-tenants.controller';
import { TenantsService } from './tenants.service';

type UploadLogoHandler = AdminTenantsController['uploadLogo'];
type UploadObjectCall = {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl: string;
};
type AuditRecordCall = {
  payload?: {
    previousKey?: string | null;
  };
};

describe('AdminTenantsController logo upload', () => {
  let controller: AdminTenantsController;
  let service: TenantsService;
  let tenantFindUnique: jest.Mock;
  let tenantUpdate: jest.Mock;
  let auditRecord: jest.Mock;
  let uploadObject: jest.Mock;
  let deleteObject: jest.Mock;
  let actor: DbUserRequestContext;

  beforeEach(() => {
    tenantFindUnique = jest.fn();
    tenantUpdate = jest.fn();
    auditRecord = jest.fn().mockResolvedValue(undefined);
    uploadObject = jest.fn().mockResolvedValue({
      kind: 'uploaded',
      key: 'tenants/tenant-id/logo-1710000000000.png',
      url: 'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-1710000000000.png',
    });
    deleteObject = jest.fn().mockResolvedValue({ kind: 'deleted' });
    actor = {
      id: 'actor-user-id',
      cognitoId: 'actor-cognito-id',
      tenantId: 'tenant-id',
      siteId: null,
      siteIds: [],
      role: 'company_admin',
    };

    jest.spyOn(Date, 'now').mockReturnValue(1710000000000);

    const prisma = {
      tenant: {
        findUnique: tenantFindUnique,
        update: tenantUpdate,
      },
    } as unknown as PrismaService;
    const audit = { record: auditRecord } as unknown as AuditService;
    const vercelDomains = {} as VercelDomainsClient;
    const route53Domains = {} as Route53DomainsClient;
    const s3 = { uploadObject, deleteObject } as unknown as S3Client;

    service = new TenantsService(
      prisma,
      audit,
      vercelDomains,
      route53Domains,
      s3,
    );
    controller = new AdminTenantsController(service);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('declares the POST logo upload route and branding capability', () => {
    const uploadLogoHandler = Object.getOwnPropertyDescriptor(
      AdminTenantsController.prototype,
      'uploadLogo',
    )?.value as UploadLogoHandler;

    expect(Reflect.getMetadata(METHOD_METADATA, uploadLogoHandler)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, uploadLogoHandler)).toBe(
      ':id/branding/logo',
    );
    expect(
      Reflect.getMetadata(REQUIRES_CAPABILITY_KEY, uploadLogoHandler),
    ).toBe(CAPABILITIES.TENANT_UPDATE_BRANDING);
  });

  it('uploads a valid PNG logo and returns the logoUrl', async () => {
    tenantFindUnique.mockResolvedValue({ id: 'tenant-id', logoUrl: null });
    tenantUpdate.mockResolvedValue({ id: 'tenant-id' });

    await expect(
      controller.uploadLogo(
        'tenant-id',
        { buffer: pngBuffer(100 * 1024), size: 100 * 1024 },
        { dbUser: actor } as never,
      ),
    ).resolves.toEqual({
      logoUrl:
        'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-1710000000000.png',
    });

    const uploadCalls = uploadObject.mock.calls as Array<[UploadObjectCall]>;
    const uploadCall = uploadCalls[0][0];
    expect(uploadCall).toMatchObject({
      key: 'tenants/tenant-id/logo-1710000000000.png',
      contentType: 'image/png',
      cacheControl: 'public, max-age=86400',
    });
    expect(Buffer.isBuffer(uploadCall.body)).toBe(true);
    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
      data: {
        logoUrl:
          'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-1710000000000.png',
      },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'tenant.logo_uploaded',
        payload: {
          newKey: 'tenants/tenant-id/logo-1710000000000.png',
          previousKey: null,
          sizeBytes: 100 * 1024,
          contentType: 'image/png',
          actorRole: 'company_admin',
          actorScope: { kind: 'tenant', tenantId: 'tenant-id' },
          capability: CAPABILITIES.TENANT_UPDATE_BRANDING,
          targetSnapshot: { tenantId: 'tenant-id' },
        },
      }),
    );
  });

  it('rejects oversized logo uploads with 413', async () => {
    await expect(
      service.uploadLogo(
        'tenant-id',
        { buffer: pngBuffer(2 * 1024 * 1024 + 1), size: 2 * 1024 * 1024 + 1 },
        actor,
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(uploadObject).not.toHaveBeenCalled();
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('rejects unsupported file formats with 415', async () => {
    await expect(
      service.uploadLogo(
        'tenant-id',
        { buffer: Buffer.from('%PDF-1.7'), size: 8 },
        actor,
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    expect(uploadObject).not.toHaveBeenCalled();
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('rejects actors without tenant branding capability with 403', () => {
    const guard = new CapabilityGuard(new Reflector());
    const uploadLogoHandler = Object.getOwnPropertyDescriptor(
      AdminTenantsController.prototype,
      'uploadLogo',
    )?.value as UploadLogoHandler;
    const request = {
      dbUser: { ...actor, role: 'employee' },
    };

    expect(() =>
      guard.canActivate({
        getHandler: () => uploadLogoHandler,
        getClass: () => AdminTenantsController,
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as never),
    ).toThrow(ForbiddenException);
  });

  it('rejects cross-tenant logo uploads with 403', async () => {
    tenantFindUnique.mockResolvedValue({ id: 'tenant-id', logoUrl: null });

    await expect(
      service.uploadLogo(
        'tenant-id',
        { buffer: pngBuffer(100 * 1024), size: 100 * 1024 },
        { ...actor, tenantId: 'other-tenant-id' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(uploadObject).not.toHaveBeenCalled();
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it('deletes the previous S3 logo after replacing it', async () => {
    tenantFindUnique.mockResolvedValue({
      id: 'tenant-id',
      logoUrl:
        'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-1700000000000.png',
    });
    tenantUpdate.mockResolvedValue({ id: 'tenant-id' });

    await expect(
      service.uploadLogo(
        'tenant-id',
        { buffer: pngBuffer(100 * 1024), size: 100 * 1024 },
        actor,
      ),
    ).resolves.toEqual({
      logoUrl:
        'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-1710000000000.png',
    });

    expect(deleteObject).toHaveBeenCalledWith({
      key: 'tenants/tenant-id/logo-1700000000000.png',
    });
    const auditCalls = auditRecord.mock.calls as Array<[AuditRecordCall]>;
    const auditCall = auditCalls[0][0];
    expect(auditCall.payload?.previousKey).toBe(
      'tenants/tenant-id/logo-1700000000000.png',
    );
  });
});

function pngBuffer(size: number): Buffer {
  const buffer = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return buffer;
}
