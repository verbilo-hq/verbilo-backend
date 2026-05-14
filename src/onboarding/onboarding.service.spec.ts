import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { type DbUserRequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let tenantFindUnique: jest.Mock;
  let tenantUpdate: jest.Mock;
  let siteCount: jest.Mock;
  let userCount: jest.Mock;
  let auditRecord: jest.Mock;

  const platformActor: DbUserRequestContext = {
    id: 'operator-user-id',
    cognitoId: 'operator-cognito-id',
    tenantId: null,
    siteId: null,
    siteIds: [],
    role: 'verbilo_support',
  };

  const customerActor: DbUserRequestContext = {
    id: 'customer-user-id',
    cognitoId: 'customer-cognito-id',
    tenantId: 'tenant-id',
    siteId: null,
    siteIds: [],
    role: 'company_admin',
  };

  beforeEach(() => {
    tenantFindUnique = jest.fn();
    tenantUpdate = jest.fn();
    siteCount = jest.fn();
    userCount = jest.fn();
    auditRecord = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      tenant: {
        findUnique: tenantFindUnique,
        update: tenantUpdate,
      },
      site: { count: siteCount },
      user: { count: userCount },
    } as unknown as PrismaService;
    const audit = { record: auditRecord } as unknown as AuditService;

    service = new OnboardingService(prisma, audit);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('derives false onboarding flags from empty observable state', async () => {
    tenantFindUnique.mockResolvedValue({
      id: 'tenant-id',
      logoUrl: null,
      primaryColor: null,
      onboardingState: {},
    });
    siteCount.mockResolvedValue(0);
    userCount.mockResolvedValue(1);

    await expect(
      service.getStateForTenant('tenant-id', customerActor),
    ).resolves.toEqual({
      sitesAdded: false,
      firstStaffInvited: false,
      brandingConfigured: false,
      starterTemplatesPublished: false,
      handoverComplete: false,
      handoverCompletedAt: null,
      handoverCompletedBy: null,
    });

    expect(siteCount).toHaveBeenCalledWith({ where: { tenantId: 'tenant-id' } });
    expect(userCount).toHaveBeenCalledWith({ where: { tenantId: 'tenant-id' } });
  });

  it('derives true onboarding flags from observable state and persisted handover', async () => {
    tenantFindUnique.mockResolvedValue({
      id: 'tenant-id',
      logoUrl: 'https://cdn.example/logo.png',
      primaryColor: '#123456',
      onboardingState: {
        handoverComplete: true,
        handoverCompletedAt: '2026-05-14T10:00:00.000Z',
        handoverCompletedBy: 'operator-user-id',
      },
    });
    siteCount.mockResolvedValue(2);
    userCount.mockResolvedValue(3);

    await expect(
      service.getStateForTenant('tenant-id', customerActor),
    ).resolves.toEqual({
      sitesAdded: true,
      firstStaffInvited: true,
      brandingConfigured: true,
      starterTemplatesPublished: false,
      handoverComplete: true,
      handoverCompletedAt: '2026-05-14T10:00:00.000Z',
      handoverCompletedBy: 'operator-user-id',
    });
  });

  it('throws 404 when the tenant is missing', async () => {
    tenantFindUnique.mockResolvedValue(null);

    await expect(
      service.getStateForTenant('missing-tenant-id', platformActor),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(siteCount).not.toHaveBeenCalled();
    expect(userCount).not.toHaveBeenCalled();
  });

  it('throws 403 when a customer actor targets another tenant', async () => {
    await expect(
      service.getStateForTenant('other-tenant-id', customerActor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('marks handover complete, preserves existing onboarding JSON, and audits it', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-14T11:12:13.000Z'));
    tenantFindUnique
      .mockResolvedValueOnce({
        id: 'tenant-id',
        onboardingState: { setupOwner: 'ops' },
      })
      .mockResolvedValueOnce({
        id: 'tenant-id',
        logoUrl: 'https://cdn.example/logo.png',
        primaryColor: '#123456',
        onboardingState: {
          setupOwner: 'ops',
          handoverComplete: true,
          handoverCompletedAt: '2026-05-14T11:12:13.000Z',
          handoverCompletedBy: 'operator-user-id',
        },
      });
    tenantUpdate.mockResolvedValue({ id: 'tenant-id' });
    siteCount.mockResolvedValue(1);
    userCount.mockResolvedValue(2);

    await expect(
      service.markHandoverComplete('tenant-id', platformActor),
    ).resolves.toEqual({
      sitesAdded: true,
      firstStaffInvited: true,
      brandingConfigured: true,
      starterTemplatesPublished: false,
      handoverComplete: true,
      handoverCompletedAt: '2026-05-14T11:12:13.000Z',
      handoverCompletedBy: 'operator-user-id',
    });

    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
      data: {
        onboardingState: {
          setupOwner: 'ops',
          handoverComplete: true,
          handoverCompletedAt: '2026-05-14T11:12:13.000Z',
          handoverCompletedBy: 'operator-user-id',
        },
      },
    });
    expect(auditRecord).toHaveBeenCalledWith({
      actorUserId: 'operator-user-id',
      tenantId: 'tenant-id',
      action: 'tenant.onboarding.handover_completed',
      entityType: 'tenant',
      entityId: 'tenant-id',
      payload: {
        handoverCompletedAt: '2026-05-14T11:12:13.000Z',
        handoverCompletedBy: 'operator-user-id',
        actorRole: 'verbilo_support',
      },
    });
  });

  it('throws 409 when handover is already complete', async () => {
    tenantFindUnique.mockResolvedValue({
      id: 'tenant-id',
      onboardingState: { handoverComplete: true },
    });

    await expect(
      service.markHandoverComplete('tenant-id', platformActor),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('returns an empty action list for platform actors without a tenant', async () => {
    await expect(service.getActionsForUser(platformActor)).resolves.toEqual([]);

    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('returns customer actions sorted undone first and done last', async () => {
    tenantFindUnique.mockResolvedValue({
      id: 'tenant-id',
      logoUrl: 'https://cdn.example/logo.png',
      primaryColor: '#123456',
      onboardingState: {},
    });
    siteCount.mockResolvedValue(1);
    userCount.mockResolvedValue(1);

    await expect(service.getActionsForUser(customerActor)).resolves.toEqual([
      expect.objectContaining({
        id: 'invite-team',
        done: false,
        nav: 'users',
      }),
      expect.objectContaining({
        id: 'publish-starter-content',
        done: false,
        nav: 'clinical',
      }),
      expect.objectContaining({
        id: 'customise-branding',
        done: true,
        nav: 'settings',
      }),
      expect.objectContaining({
        id: 'add-first-site',
        done: true,
        nav: 'settings',
      }),
    ]);
  });
});
