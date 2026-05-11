import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';
import { UpdateTenantDto } from './update-tenant.dto';

describe('Tenant DTOs', () => {
  describe('CreateTenantDto', () => {
    it('accepts a valid payload', () => {
      const payload = {
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: ['documents'],
      };

      const errors = validateSync(plainToInstance(CreateTenantDto, payload));
      expect(errors).toHaveLength(0);
    });

    it('rejects missing slug', () => {
      const payload = {
        name: 'Acme Dental',
        sector: 'dental',
      };

      const errors = validateSync(plainToInstance(CreateTenantDto, payload));
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects names longer than 120 chars', () => {
      const payload = {
        name: 'a'.repeat(121),
        slug: 'acme-dental',
        sector: 'dental',
      };

      const errors = validateSync(plainToInstance(CreateTenantDto, payload));
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects enabledModules arrays longer than 32 entries', () => {
      const payload = {
        name: 'Acme Dental',
        slug: 'acme-dental',
        sector: 'dental',
        enabledModules: Array.from({ length: 33 }, (_, index) => `m${index}`),
      };

      const errors = validateSync(plainToInstance(CreateTenantDto, payload));
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('UpdateTenantDto', () => {
    it('accepts an empty payload (all fields optional)', () => {
      const payload = {};

      const errors = validateSync(plainToInstance(UpdateTenantDto, payload));
      expect(errors).toHaveLength(0);
    });

    it('rejects invalid settings types', () => {
      const payload = { settings: 'not-an-object' };

      const errors = validateSync(plainToInstance(UpdateTenantDto, payload));
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

