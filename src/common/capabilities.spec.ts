import {
  CAPABILITIES,
  CAPABILITY_VALUES,
  capabilitiesFor,
  hasCapability,
  roleRanksAtOrAbove,
} from './capabilities';
import { USER_ROLES, type UserRole } from './user-roles';

describe('capabilities', () => {
  it('defines capabilities for all supported roles', () => {
    for (const role of USER_ROLES) {
      expect(capabilitiesFor(role)).toBeInstanceOf(Set);
    }
  });

  it('grants every capability to verbilo_super_admin', () => {
    for (const capability of CAPABILITY_VALUES) {
      expect(hasCapability('verbilo_super_admin', capability)).toBe(true);
    }
  });

  it('grants support read/update capabilities but not destructive capabilities', () => {
    expect(hasCapability('verbilo_support', CAPABILITIES.TENANT_UPDATE)).toBe(
      true,
    );
    expect(hasCapability('verbilo_support', CAPABILITIES.USERS_LIST)).toBe(
      true,
    );
    expect(hasCapability('verbilo_support', CAPABILITIES.TENANT_DELETE)).toBe(
      false,
    );
    expect(
      hasCapability('verbilo_support', CAPABILITIES.USERS_UPDATE_ROLE),
    ).toBe(false);
    expect(
      hasCapability('verbilo_support', CAPABILITIES.USERS_ASSIGN_SITE),
    ).toBe(true);
  });

  it('grants tenant user-management capabilities to tenant managers and owners', () => {
    const roles: UserRole[] = [
      'company_owner',
      'company_admin',
      'area_manager',
      'practice_manager',
    ];

    for (const role of roles) {
      expect(hasCapability(role, CAPABILITIES.USERS_LIST)).toBe(true);
      expect(hasCapability(role, CAPABILITIES.USERS_CREATE)).toBe(true);
      expect(hasCapability(role, CAPABILITIES.USERS_UPDATE_ROLE)).toBe(true);
      expect(hasCapability(role, CAPABILITIES.USERS_DISABLE)).toBe(true);
      expect(hasCapability(role, CAPABILITIES.USERS_RESET_PASSWORD)).toBe(true);
    }
  });

  it('grants site assignment only to support, tenant admins, and area managers', () => {
    expect(
      hasCapability('verbilo_super_admin', CAPABILITIES.USERS_ASSIGN_SITE),
    ).toBe(true);
    expect(
      hasCapability('verbilo_support', CAPABILITIES.USERS_ASSIGN_SITE),
    ).toBe(true);
    expect(
      hasCapability('company_owner', CAPABILITIES.USERS_ASSIGN_SITE),
    ).toBe(true);
    expect(
      hasCapability('company_admin', CAPABILITIES.USERS_ASSIGN_SITE),
    ).toBe(true);
    expect(
      hasCapability('area_manager', CAPABILITIES.USERS_ASSIGN_SITE),
    ).toBe(true);
    expect(
      hasCapability('practice_manager', CAPABILITIES.USERS_ASSIGN_SITE),
    ).toBe(false);
    expect(hasCapability('employee', CAPABILITIES.USERS_ASSIGN_SITE)).toBe(
      false,
    );
  });

  it('keeps tenant lifecycle capabilities above site-scoped roles', () => {
    expect(hasCapability('company_owner', CAPABILITIES.TENANT_UPDATE)).toBe(
      true,
    );
    expect(
      hasCapability('company_owner', CAPABILITIES.TENANT_UPDATE_BRANDING),
    ).toBe(true);
    expect(hasCapability('area_manager', CAPABILITIES.TENANT_UPDATE)).toBe(
      false,
    );
    expect(hasCapability('practice_manager', CAPABILITIES.TENANT_UPDATE)).toBe(
      false,
    );
    expect(hasCapability('employee', CAPABILITIES.USERS_LIST)).toBe(false);
  });

  it('orders role ranks for privilege checks', () => {
    expect(roleRanksAtOrAbove('verbilo_super_admin', 'verbilo_support')).toBe(
      true,
    );
    expect(roleRanksAtOrAbove('company_owner', 'company_admin')).toBe(true);
    expect(roleRanksAtOrAbove('company_admin', 'company_admin')).toBe(true);
    expect(roleRanksAtOrAbove('company_admin', 'company_owner')).toBe(false);
    expect(roleRanksAtOrAbove('practice_manager', 'area_manager')).toBe(false);
    expect(roleRanksAtOrAbove('employee', 'employee')).toBe(true);
  });
});
