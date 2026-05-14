import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CAPABILITIES } from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';
import {
  type CognitoAdminClient,
  CognitoUserNotFoundError,
} from '../integrations/aws/cognito-admin.client';
import type { Route53DomainsClient } from '../integrations/aws/route53.client';
import type { S3Client } from '../integrations/aws/s3.client';
import { VercelDomainsClient } from '../integrations/vercel/vercel-domains.client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from './tenants.service';

type TenantDeleteTransaction = {
  auditLog: { create: jest.Mock };
  tenant: { delete: jest.Mock };
};

type TenantDeleteTransactionCallback = (tx: TenantDeleteTransaction) => unknown;

jest.mock('../integrations/aws/route53.client', () => ({
  Route53DomainsClient: jest.fn(),
}));

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantFindUnique: jest.Mock;
  let tenantCreate: jest.Mock;
  let tenantUpdate: jest.Mock;
  let tenantDelete: jest.Mock;
  let auditLogCreate: jest.Mock;
  let transaction: jest.Mock;
  let auditRecord: jest.Mock;
  let provisionTenantDomain: jest.Mock;
  let removeTenantDomain: jest.Mock;
  let hostnameForSlug: jest.Mock;
  let createTenantCname: jest.Mock;
  let removeTenantCname: jest.Mock;
  let route53HostnameForSlug: jest.Mock;
  let uploadObject: jest.Mock;
  let deleteObject: jest.Mock;
  // VER-76: tenant delete also iterates Cognito users; mock both the
  // tenant-user lookup and the Cognito AdminDeleteUser call.
  let userFindMany: jest.Mock;
  let cognitoAdminDeleteUser: jest.Mock;
  const actor: DbUserRequestContext = {
    id: 'actor-user-id',
    cognitoId: 'actor-cognito-id',
    tenantId: null,
    siteId: null,
    siteIds: [],
    role: 'verbilo_super_admin',
  };

  beforeEach(() => {
    tenantFindUnique = jest.fn();
    tenantCreate = jest.fn();
    tenantUpdate = jest.fn();
    tenantDelete = jest.fn();
    auditLogCreate = jest.fn().mockResolvedValue(undefined);
    transaction = jest.fn((callback: TenantDeleteTransactionCallback) =>
      Promise.resolve(
        callback({
          auditLog: { create: auditLogCreate },
          tenant: { delete: tenantDelete },
        }),
      ),
    );
    auditRecord = jest.fn().mockResolvedValue(undefined);
    provisionTenantDomain = jest.fn().mockResolvedValue({
      status: 'skipped',
      hostname: 'acme.verbilo.co.uk',
      reason: 'vercel-not-configured',
    });
    removeTenantDomain = jest.fn().mockResolvedValue({
      status: 'removed',
      hostname: 'acme.verbilo.co.uk',
    });
    hostnameForSlug = jest.fn((slug: string) => `${slug}.verbilo.co.uk`);
    createTenantCname = jest.fn().mockResolvedValue({
      status: 'skipped',
      hostname: 'acme.verbilo.co.uk',
      reason: 'route53-not-configured',
    });
    removeTenantCname = jest.fn().mockResolvedValue({
      status: 'removed',
      hostname: 'acme.verbilo.co.uk',
    });
    route53HostnameForSlug = jest.fn((slug: string) => `${slug}.verbilo.co.uk`);
    uploadObject = jest.fn().mockResolvedValue({
      kind: 'uploaded',
      key: 'tenants/tenant-id/logo-123.png',
      url: 'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-123.png',
    });
    deleteObject = jest.fn().mockResolvedValue({ kind: 'deleted' });
    // VER-76: default to "no users to clean up" so legacy delete tests
    // that didn't model users still pass without explicit setup.
    userFindMany = jest.fn().mockResolvedValue([]);
    cognitoAdminDeleteUser = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      tenant: {
        findUnique: tenantFindUnique,
        create: tenantCreate,
        update: tenantUpdate,
      },
      // VER-76: deleteTenant snapshots tenant.user usernames so it can
      // tear down the matching Cognito accounts after the transaction.
      // Default the mock to "no users" so tests that don't care about
      // this don't need to set it up.
      user: {
        findMany: userFindMany,
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const audit = {
      record: auditRecord,
    } as unknown as AuditService;

    const vercelDomains = {
      provisionTenantDomain,
      removeTenantDomain,
      hostnameForSlug,
    } as unknown as VercelDomainsClient;

    const route53Domains = {
      createTenantCname,
      removeTenantCname,
      hostnameForSlug: route53HostnameForSlug,
    } as unknown as Route53DomainsClient;

    const s3 = {
      uploadObject,
      deleteObject,
    } as unknown as S3Client;

    // VER-76: AdminDeleteUser is called once per tenant user during
    // deleteTenant. Default to a clean resolve so the common-case
    // "delete tenant with no users" tests stay terse.
    const cognitoAdmin = {
      adminDeleteUser: cognitoAdminDeleteUser,
    } as unknown as CognitoAdminClient;

    service = new TenantsService(
      prisma,
      audit,
      vercelDomains,
      route53Domains,
      s3,
      cognitoAdmin,
    );
  });

  it('rejects invalid slugs before checking the database', async () => {
    await expect(
      service.createTenant({
        name: 'Acme Dental',
        slug: 'ab',
        sector: 'dental',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(tenantCreate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
    expect(provisionTenantDomain).not.toHaveBeenCalled();
    expect(createTenantCname).not.toHaveBeenCalled();
  });

  it('rejects reserved slugs before checking the database', async () => {
    await expect(
      service.createTenant({
        name: 'Admin Dental',
        slug: 'admin',
        sector: 'dental',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(tenantCreate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
    expect(provisionTenantDomain).not.toHaveBeenCalled();
    expect(createTenantCname).not.toHaveBeenCalled();
  });

  it('rejects taken slugs', async () => {
    tenantFindUnique.mockResolvedValue({ id: 'existing-tenant-id' });

    await expect(
      service.createTenant({
        name: 'Taken Dental',
        slug: 'taken-dental',
        sector: 'dental',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { slug: 'taken-dental' },
      select: { id: true },
    });
    expect(tenantCreate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
    expect(provisionTenantDomain).not.toHaveBeenCalled();
    expect(createTenantCname).not.toHaveBeenCalled();
  });

  it('creates tenants, provisions the Vercel domain, and writes audit rows', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(null);
    tenantCreate.mockResolvedValue(tenant);
    provisionTenantDomain.mockResolvedValue({
      status: 'provisioned',
      hostname: 'acme-dental.verbilo.co.uk',
      verified: true,
      vercelDomain: { verified: true },
    });
    createTenantCname.mockResolvedValue({
      status: 'created',
      hostname: 'acme-dental.verbilo.co.uk',
      changeId: '/change/C123',
    });

    await expect(
      service.createTenant(
        {
          name: ' Acme Dental ',
          slug: 'ACME Dental',
          sector: 'dental',
          enabledModules: ['documents'],
        },
        actor,
      ),
    ).resolves.toEqual({
      ...tenant,
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(tenantCreate).toHaveBeenCalledWith({
      data: {
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: ['documents'],
      },
    });
    expect(auditRecord).toHaveBeenNthCalledWith(1, {
      actorUserId: 'actor-user-id',
      tenantId: 'tenant-id',
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: ['documents'],
        actorRole: 'verbilo_super_admin',
        actorScope: { kind: 'platform' },
        capability: CAPABILITIES.TENANT_CREATE,
        targetSnapshot: { tenantId: 'tenant-id' },
      },
    });
    expect(provisionTenantDomain).toHaveBeenCalledWith('acme-dental', 'main');
    expect(createTenantCname).toHaveBeenCalledWith('acme-dental');
    expect(auditRecord).toHaveBeenNthCalledWith(2, {
      actorUserId: 'actor-user-id',
      tenantId: 'tenant-id',
      action: 'tenant.domain.provisioned',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        outcome: {
          status: 'provisioned',
          hostname: 'acme-dental.verbilo.co.uk',
          verified: true,
          vercelDomain: { verified: true },
        },
      },
    });
    expect(auditRecord).toHaveBeenNthCalledWith(3, {
      actorUserId: 'actor-user-id',
      tenantId: 'tenant-id',
      action: 'tenant.dns.created',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        outcome: {
          status: 'created',
          hostname: 'acme-dental.verbilo.co.uk',
          changeId: '/change/C123',
        },
      },
    });

    expect(tenantCreate.mock.invocationCallOrder[0]).toBeLessThan(
      provisionTenantDomain.mock.invocationCallOrder[0],
    );
    expect(auditRecord.mock.invocationCallOrder[0]).toBeLessThan(
      provisionTenantDomain.mock.invocationCallOrder[0],
    );
    expect(provisionTenantDomain.mock.invocationCallOrder[0]).toBeLessThan(
      createTenantCname.mock.invocationCallOrder[0],
    );
  });

  it('records a provision_failed audit log when Vercel provisioning throws and still returns the tenant', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(null);
    tenantCreate.mockResolvedValue(tenant);
    provisionTenantDomain.mockRejectedValue(new Error('boom'));
    createTenantCname.mockResolvedValue({
      status: 'created',
      hostname: 'acme-dental.verbilo.co.uk',
      changeId: null,
    });

    await expect(
      service.createTenant(
        {
          name: 'Acme Dental',
          slug: 'acme-dental',
          sector: 'dental',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      id: 'tenant-id',
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(auditRecord).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'tenant.domain.provision_failed',
        payload: {
          hostname: 'acme-dental.verbilo.co.uk',
          error: 'boom',
        },
      }),
    );
    expect(createTenantCname).toHaveBeenCalledWith('acme-dental');
    expect(auditRecord).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: 'tenant.dns.created',
        payload: {
          outcome: {
            status: 'created',
            hostname: 'acme-dental.verbilo.co.uk',
            changeId: null,
          },
        },
      }),
    );
  });

  it('records a dns.create_failed audit log when Route 53 create throws and still returns the tenant', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(null);
    tenantCreate.mockResolvedValue(tenant);
    createTenantCname.mockRejectedValue(new Error('r53 boom'));

    await expect(
      service.createTenant(
        {
          name: 'Acme Dental',
          slug: 'acme-dental',
          sector: 'dental',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      id: 'tenant-id',
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(auditRecord).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: 'tenant.dns.create_failed',
        payload: {
          hostname: 'acme-dental.verbilo.co.uk',
          error: 'r53 boom',
        },
      }),
    );
  });

  // VER-47: cross-sector coverage so the dental-flavoured fixtures above
  // don't make this look like a dental-only product.
  it('creates a non-dental tenant cleanly (vets sector)', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id-vets',
      name: 'Riverside Vets',
      slug: 'riverside-vets',
      sector: 'vets',
      enabledModules: [],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(null);
    tenantCreate.mockResolvedValue(tenant);

    await expect(
      service.createTenant({
        name: 'Riverside Vets',
        slug: 'riverside-vets',
        sector: 'vets',
      }),
    ).resolves.toMatchObject({
      sector: 'vets',
      url: 'https://riverside-vets.verbilo.co.uk',
    });

    const createCalls = tenantCreate.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(createCalls[0][0].data).toMatchObject({
      name: 'Riverside Vets',
      slug: 'riverside-vets',
      sector: 'vets',
    });
  });

  it('updates tenants and writes authorization context in the audit payload', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };
    const updatedTenant = {
      ...existingTenant,
      name: 'Acme Health',
      enabledModules: ['documents', 'staff'],
    };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);

    await expect(
      service.updateTenant(
        'tenant-id',
        {
          name: 'Acme Health',
          enabledModules: ['documents', 'staff'],
        },
        actor,
      ),
    ).resolves.toEqual({
      ...updatedTenant,
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
      data: {
        name: 'Acme Health',
        enabledModules: ['documents', 'staff'],
      },
    });
    expect(auditRecord).toHaveBeenCalledWith({
      actorUserId: 'actor-user-id',
      tenantId: 'tenant-id',
      action: 'tenant.settings.updated',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        diff: {
          name: { from: 'Acme Dental', to: 'Acme Health' },
          enabledModules: {
            from: ['documents'],
            to: ['documents', 'staff'],
          },
        },
        actorRole: 'verbilo_super_admin',
        actorScope: { kind: 'platform' },
        capability: CAPABILITIES.TENANT_UPDATE,
        targetSnapshot: { tenantId: 'tenant-id' },
      },
    });
  });

  // VER-70: sector edits are now gated to verbilo_super_admin via a
  // dedicated capability. Support can still touch other UpdateTenant
  // fields; only sector trips the 403.
  it('allows verbilo_super_admin to change tenant sector', async () => {
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt: new Date('2026-05-10T10:00:00.000Z'),
    };
    const updatedTenant = { ...existingTenant, sector: 'vets' };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);

    await expect(
      service.updateTenant('tenant-id', { sector: 'vets' }, actor),
    ).resolves.toEqual({
      ...updatedTenant,
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
      data: { sector: 'vets' },
    });
  });

  it('rejects sector edits from verbilo_support with 403', async () => {
    const supportActor: DbUserRequestContext = {
      id: 'support-user-id',
      cognitoId: 'support-cognito-id',
      tenantId: null,
      siteId: null,
      siteIds: [],
      role: 'verbilo_support',
    };
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt: new Date('2026-05-10T10:00:00.000Z'),
    };

    tenantFindUnique.mockResolvedValue(existingTenant);

    await expect(
      service.updateTenant('tenant-id', { sector: 'vets' }, supportActor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it('lets verbilo_support update non-sector fields without 403', async () => {
    const supportActor: DbUserRequestContext = {
      id: 'support-user-id',
      cognitoId: 'support-cognito-id',
      tenantId: null,
      siteId: null,
      siteIds: [],
      role: 'verbilo_support',
    };
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt: new Date('2026-05-10T10:00:00.000Z'),
    };
    const updatedTenant = { ...existingTenant, name: 'Acme Health' };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);

    await expect(
      service.updateTenant('tenant-id', { name: 'Acme Health' }, supportActor),
    ).resolves.toEqual({
      ...updatedTenant,
      url: 'https://acme-dental.verbilo.co.uk',
    });
  });

  it('treats a no-op sector echo as not a sector change (no 403)', async () => {
    // If support sends `sector: 'dental'` and the tenant is already
    // dental, that's not actually an edit — don't throw. Keeps the
    // dropdown bound to existing state safe for read-only renders that
    // still send the value back unchanged.
    const supportActor: DbUserRequestContext = {
      id: 'support-user-id',
      cognitoId: 'support-cognito-id',
      tenantId: null,
      siteId: null,
      siteIds: [],
      role: 'verbilo_support',
    };
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt: new Date('2026-05-10T10:00:00.000Z'),
    };
    const updatedTenant = { ...existingTenant, name: 'Acme Health' };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);

    await expect(
      service.updateTenant(
        'tenant-id',
        { sector: 'dental', name: 'Acme Health' },
        supportActor,
      ),
    ).resolves.toEqual({
      ...updatedTenant,
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
      data: { name: 'Acme Health' },
    });
  });

  it('updates tenant branding, skips empty strings, and writes the diff with authorization context', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const companyAdmin: DbUserRequestContext = {
      id: 'company-admin-id',
      cognitoId: 'company-admin-cognito-id',
      tenantId: 'tenant-id',
      siteId: null,
      siteIds: [],
      role: 'company_admin',
    };
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      logoUrl: 'https://cdn.example.com/old-logo.png',
      primaryColor: '#123456',
      secondaryColor: '#abcdef',
      accentColor: '#fedcba',
      archivedAt: null,
      createdAt,
    };
    const updatedTenant = {
      ...existingTenant,
      logoUrl: 'https://cdn.example.com/new-logo.png',
      primaryColor: '#FFFFFF',
      accentColor: null,
    };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);

    await expect(
      service.updateBranding(
        'tenant-id',
        {
          logoUrl: ' https://cdn.example.com/new-logo.png ',
          primaryColor: '#FFFFFF',
          secondaryColor: '',
          accentColor: null,
        },
        companyAdmin,
      ),
    ).resolves.toEqual({
      ...updatedTenant,
      url: 'https://acme-dental.verbilo.co.uk',
    });

    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
      data: {
        logoUrl: 'https://cdn.example.com/new-logo.png',
        primaryColor: '#FFFFFF',
        accentColor: null,
      },
    });
    expect(auditRecord).toHaveBeenCalledWith({
      actorUserId: 'company-admin-id',
      tenantId: 'tenant-id',
      action: 'tenant.branding.updated',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        diff: {
          logoUrl: {
            from: 'https://cdn.example.com/old-logo.png',
            to: 'https://cdn.example.com/new-logo.png',
          },
          primaryColor: { from: '#123456', to: '#FFFFFF' },
          accentColor: { from: '#fedcba', to: null },
        },
        actorRole: 'company_admin',
        actorScope: { kind: 'tenant', tenantId: 'tenant-id' },
        capability: CAPABILITIES.TENANT_UPDATE_BRANDING,
        targetSnapshot: { tenantId: 'tenant-id' },
      },
    });
  });

  // VER-77: when an existing CDN-hosted logo is replaced or cleared,
  // delete the previous S3 object as well. Branding update is the
  // source of truth — operator clicked Save Branding after Remove (or
  // pasted a different URL over an upload).
  it('deletes the previous CDN logo from S3 when logoUrl is cleared', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const previousCdnUrl =
      'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-111.png';
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      logoUrl: previousCdnUrl,
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      archivedAt: null,
      createdAt,
    };
    const updatedTenant = { ...existingTenant, logoUrl: null };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);

    await service.updateBranding('tenant-id', { logoUrl: null }, actor);

    expect(deleteObject).toHaveBeenCalledWith({
      key: 'tenants/tenant-id/logo-111.png',
    });
  });

  it('does NOT touch S3 when clearing an external logoUrl', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      logoUrl: 'https://cdn.example.com/old-logo.png',
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      archivedAt: null,
      createdAt,
    };
    const updatedTenant = { ...existingTenant, logoUrl: null };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);

    await service.updateBranding('tenant-id', { logoUrl: null }, actor);

    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('still resolves when S3 delete fails during branding clear', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const previousCdnUrl =
      'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-222.png';
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      logoUrl: previousCdnUrl,
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      archivedAt: null,
      createdAt,
    };
    const updatedTenant = { ...existingTenant, logoUrl: null };

    tenantFindUnique.mockResolvedValue(existingTenant);
    tenantUpdate.mockResolvedValue(updatedTenant);
    deleteObject.mockRejectedValueOnce(new Error('S3 outage'));

    // Branding update still completes successfully despite S3 trouble.
    await expect(
      service.updateBranding('tenant-id', { logoUrl: null }, actor),
    ).resolves.toEqual(
      expect.objectContaining({ logoUrl: null }),
    );
    // Audit log captures the branding change (the S3 failure is just
    // logged as a warning, not a separate audit row in this flow).
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.branding.updated' }),
    );
  });

  it('rejects tenant branding updates outside the actor tenant scope', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const companyAdmin: DbUserRequestContext = {
      id: 'company-admin-id',
      cognitoId: 'company-admin-cognito-id',
      tenantId: 'tenant-a-id',
      siteId: null,
      siteIds: [],
      role: 'company_admin',
    };
    const existingTenant = {
      id: 'tenant-b-id',
      name: 'Riverside Vets',
      slug: 'riverside-vets',
      sector: 'vets',
      enabledModules: [],
      settings: {},
      logoUrl: null,
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(existingTenant);

    await expect(
      service.updateBranding(
        'tenant-b-id',
        { primaryColor: '#123456' },
        companyAdmin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('rejects tenant branding updates with no real changes', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const existingTenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColor: '#123456',
      secondaryColor: null,
      accentColor: null,
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(existingTenant);

    await expect(
      service.updateBranding(
        'tenant-id',
        {
          logoUrl: 'https://cdn.example.com/logo.png',
          primaryColor: '#123456',
          secondaryColor: '',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('selects branding fields for the public tenant lookup', async () => {
    const tenant = {
      id: 'tenant-id',
      slug: 'acme-dental',
      name: 'Acme Dental',
      sector: 'dental',
      enabledModules: ['documents'],
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColor: '#123456',
      secondaryColor: '#abcdef',
      accentColor: '#fedcba',
    };

    tenantFindUnique.mockResolvedValue(tenant);

    await expect(service.getPublicTenantBySlug('acme-dental')).resolves.toEqual(
      tenant,
    );

    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { slug: 'acme-dental' },
      select: {
        id: true,
        slug: true,
        name: true,
        sector: true,
        enabledModules: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        accentColor: true,
      },
    });
  });

  it('deletes tenants, removes the Vercel domain, and writes audit rows', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);
    removeTenantDomain.mockResolvedValue({
      status: 'removed',
      hostname: 'acme-dental.verbilo.co.uk',
    });
    removeTenantCname.mockResolvedValue({
      status: 'removed',
      hostname: 'acme-dental.verbilo.co.uk',
    });

    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'tenant.deleted',
        entityType: 'tenant',
        entityId: 'tenant-id',
        payloadJson: {
          snapshot: {
            id: 'tenant-id',
            slug: 'acme-dental',
            name: 'Acme Dental',
            sector: 'dental',
            enabledModules: ['documents'],
            createdAt,
          },
          // VER-76: empty array when the tenant has no customer users.
          cognitoUsernames: [],
          actorRole: 'verbilo_super_admin',
          actorScope: { kind: 'platform' },
          capability: CAPABILITIES.TENANT_DELETE,
          targetSnapshot: { tenantId: 'tenant-id' },
        },
      },
    });
    expect(tenantDelete).toHaveBeenCalledWith({ where: { id: 'tenant-id' } });
    expect(removeTenantCname).toHaveBeenCalledWith('acme-dental');
    expect(removeTenantDomain).toHaveBeenCalledWith('acme-dental');
    expect(removeTenantCname.mock.invocationCallOrder[0]).toBeLessThan(
      removeTenantDomain.mock.invocationCallOrder[0],
    );
    expect(auditRecord).toHaveBeenCalledWith({
      actorUserId: 'actor-user-id',
      action: 'tenant.dns.removed',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        outcome: {
          status: 'removed',
          hostname: 'acme-dental.verbilo.co.uk',
        },
        slug: 'acme-dental',
      },
    });
    expect(auditRecord).toHaveBeenCalledWith({
      actorUserId: 'actor-user-id',
      action: 'tenant.domain.removed',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        outcome: {
          status: 'removed',
          hostname: 'acme-dental.verbilo.co.uk',
        },
        slug: 'acme-dental',
      },
    });
  });

  it('throws NotFoundException when deleting a missing tenant', async () => {
    tenantFindUnique.mockResolvedValue(null);

    await expect(
      service.deleteTenant('missing-tenant-id', actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transaction).not.toHaveBeenCalled();
    expect(removeTenantCname).not.toHaveBeenCalled();
    expect(removeTenantDomain).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('records a remove_failed audit log when Vercel removal throws and still resolves', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);
    removeTenantDomain.mockRejectedValue(new Error('boom'));

    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    expect(removeTenantCname).toHaveBeenCalledWith('acme-dental');

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.domain.remove_failed',
        payload: {
          slug: 'acme-dental',
          error: 'boom',
        },
      }),
    );
  });

  it('records a dns.remove_failed audit log when Route 53 removal throws and still removes the Vercel domain', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);
    removeTenantCname.mockRejectedValue(new Error('r53 boom'));

    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.dns.remove_failed',
        payload: {
          hostname: 'acme-dental.verbilo.co.uk',
          slug: 'acme-dental',
          error: 'r53 boom',
        },
      }),
    );
    expect(removeTenantDomain).toHaveBeenCalledWith('acme-dental');
  });

  // VER-76: tenant delete cascades into Cognito for each customer user
  // (best-effort, like Vercel + Route53).
  it('deletes Cognito accounts for each tenant user during tenant delete', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);
    userFindMany.mockResolvedValue([
      { username: 's.jenkins' },
      { username: 'a.kumar' },
      { username: 'm.lee' },
    ]);

    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    // One AdminDeleteUser call per snapshot row.
    expect(cognitoAdminDeleteUser).toHaveBeenCalledTimes(3);
    expect(cognitoAdminDeleteUser).toHaveBeenCalledWith('s.jenkins');
    expect(cognitoAdminDeleteUser).toHaveBeenCalledWith('a.kumar');
    expect(cognitoAdminDeleteUser).toHaveBeenCalledWith('m.lee');

    // Each success → an audit row with `tenant.user.cognito_deleted`.
    for (const username of ['s.jenkins', 'a.kumar', 'm.lee']) {
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.user.cognito_deleted',
          payload: expect.objectContaining({ username }),
        }),
      );
    }

    // tenant.deleted audit payload includes the cohort snapshot so we
    // can reconstruct what was cleaned even if the per-row audits get
    // truncated.
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            cognitoUsernames: ['s.jenkins', 'a.kumar', 'm.lee'],
          }),
        }),
      }),
    );
  });

  it('logs a cognito_delete_failed audit row when Cognito errors during tenant delete', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);
    userFindMany.mockResolvedValue([{ username: 's.jenkins' }]);
    cognitoAdminDeleteUser.mockRejectedValue(new Error('AccessDenied'));

    // Tenant delete still resolves — DB already committed, this
    // cleanup is best-effort.
    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.user.cognito_delete_failed',
        payload: expect.objectContaining({
          username: 's.jenkins',
          error: 'AccessDenied',
        }),
      }),
    );
  });

  it('treats UserNotFoundException as an idempotent no-op (no audit noise)', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);
    userFindMany.mockResolvedValue([{ username: 'ghost' }]);
    cognitoAdminDeleteUser.mockRejectedValue(
      new CognitoUserNotFoundError('ghost'),
    );

    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    // No success audit (we never reached the success branch) AND no
    // failure audit (UserNotFoundException is idempotent).
    expect(auditRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.user.cognito_deleted',
      }),
    );
    expect(auditRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.user.cognito_delete_failed',
      }),
    );
  });

  // VER-77: tenant delete also tears down the tenant's CDN-hosted logo
  // from S3, in addition to Vercel + Route53 + Cognito.
  it('deletes the CDN logo from S3 during tenant delete', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const cdnLogoUrl =
      'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-9000.webp';
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      logoUrl: cdnLogoUrl,
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);

    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    expect(deleteObject).toHaveBeenCalledWith({
      key: 'tenants/tenant-id/logo-9000.webp',
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.logo.removed',
        payload: expect.objectContaining({
          key: 'tenants/tenant-id/logo-9000.webp',
          slug: 'acme-dental',
        }),
      }),
    );
  });

  it('skips S3 cleanup when the tenant has no logo or an external logo', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      // External URL — not our CDN; we don't own this object.
      logoUrl: 'https://cdn.example.com/their-logo.png',
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);

    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    expect(deleteObject).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.logo.removed' }),
    );
  });

  it('logs a logo.remove_failed audit when S3 errors during tenant delete', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const cdnLogoUrl =
      'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/tenants/tenant-id/logo-9001.webp';
    const tenant = {
      id: 'tenant-id',
      name: 'Acme Dental',
      slug: 'acme-dental',
      sector: 'dental',
      enabledModules: ['documents'],
      settings: {},
      logoUrl: cdnLogoUrl,
      archivedAt: null,
      createdAt,
    };

    tenantFindUnique.mockResolvedValue(tenant);
    tenantDelete.mockResolvedValue(tenant);
    deleteObject.mockRejectedValueOnce(new Error('S3 outage'));

    // Tenant delete still resolves — DB row + Vercel + Route53 already
    // cleaned; the S3 failure is best-effort cleanup.
    await expect(
      service.deleteTenant('tenant-id', actor),
    ).resolves.toBeUndefined();

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.logo.remove_failed',
        payload: expect.objectContaining({
          key: 'tenants/tenant-id/logo-9001.webp',
          error: 'S3 outage',
        }),
      }),
    );
  });
});
