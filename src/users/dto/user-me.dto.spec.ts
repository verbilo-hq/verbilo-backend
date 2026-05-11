import { plainToInstance } from 'class-transformer';
import { UserMeDto } from './user-me.dto';

describe('UserMeDto', () => {
  it('strips internal user fields with excludeExtraneousValues', () => {
    const fullPrismaUser = {
      id: 'u_123',
      username: 'alice',
      role: 'ADMIN',
      cognitoId: 'cognito-sub-123',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      tenantId: 't_123',
      siteId: 's_123',
      tenant: {
        id: 't_123',
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: ['documents'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      site: {
        id: 's_123',
        name: 'Main Site',
        tenantId: 't_123',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    };

    const dto = plainToInstance(UserMeDto, fullPrismaUser, {
      excludeExtraneousValues: true,
    });

    expect((dto as any).cognitoId).toBeUndefined();
    expect((dto as any).createdAt).toBeUndefined();
    expect((dto as any).tenantId).toBeUndefined();
    expect((dto as any).siteId).toBeUndefined();
    expect((dto.tenant as any).createdAt).toBeUndefined();
    expect((dto.site as any).tenantId).toBeUndefined();

    expect(dto).toEqual({
      id: 'u_123',
      username: 'alice',
      role: 'ADMIN',
      tenant: {
        id: 't_123',
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: ['documents'],
      },
      site: {
        id: 's_123',
        name: 'Main Site',
      },
    });
  });

  it('preserves site: null', () => {
    const fullPrismaUser = {
      id: 'u_123',
      username: 'alice',
      role: 'MEMBER',
      cognitoId: 'cognito-sub-123',
      tenant: {
        id: 't_123',
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: [],
      },
      site: null,
    };

    const dto = plainToInstance(UserMeDto, fullPrismaUser, {
      excludeExtraneousValues: true,
    });

    expect(dto.site).toBeNull();
    expect(dto).toEqual({
      id: 'u_123',
      username: 'alice',
      role: 'MEMBER',
      tenant: {
        id: 't_123',
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: [],
      },
      site: null,
    });
  });

  it('preserves tenant: null for platform admins', () => {
    const fullPrismaUser = {
      id: 'u_123',
      username: 'alice',
      role: 'verbilo_super_admin',
      tenant: null,
      site: null,
    };

    const dto = plainToInstance(UserMeDto, fullPrismaUser, {
      excludeExtraneousValues: true,
    });

    expect(dto.tenant).toBeNull();
    expect(dto).toEqual({
      id: 'u_123',
      username: 'alice',
      role: 'verbilo_super_admin',
      tenant: null,
      site: null,
    });
  });
});
