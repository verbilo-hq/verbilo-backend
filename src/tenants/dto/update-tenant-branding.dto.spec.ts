import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateTenantBrandingDto } from './update-tenant-branding.dto';

describe('UpdateTenantBrandingDto', () => {
  it.each(['#FFF', '#FFFF', '#FFFFFF', '#FFFFFFFF'])(
    'accepts %s as a valid hex color',
    (color) => {
      const errors = validateSync(
        plainToInstance(UpdateTenantBrandingDto, {
          primaryColor: color,
          secondaryColor: color,
          accentColor: color,
        }),
      );

      expect(errors).toHaveLength(0);
    },
  );

  it.each(['red', '#GG', '#FFFFF', 'FFFFFF', '#FFFFFFFFF'])(
    'rejects %s as an invalid hex color',
    (color) => {
      const errors = validateSync(
        plainToInstance(UpdateTenantBrandingDto, { primaryColor: color }),
      );

      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it('accepts null and empty strings so the service can handle clear and leave-alone semantics', () => {
    const errors = validateSync(
      plainToInstance(UpdateTenantBrandingDto, {
        logoUrl: '   ',
        primaryColor: null,
        secondaryColor: '',
        accentColor: '   ',
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('caps logoUrl length', () => {
    const errors = validateSync(
      plainToInstance(UpdateTenantBrandingDto, {
        logoUrl: 'a'.repeat(2049),
      }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });
});
