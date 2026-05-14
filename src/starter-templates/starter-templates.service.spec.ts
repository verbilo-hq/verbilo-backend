import { BadRequestException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import {
  StarterTemplatesService,
  type StarterTemplateItem,
} from './starter-templates.service';

describe('StarterTemplatesService', () => {
  let service: StarterTemplatesService;
  let tenantFindUnique: jest.Mock;

  beforeEach(() => {
    tenantFindUnique = jest.fn();

    const prisma = {
      tenant: {
        findUnique: tenantFindUnique,
      },
    } as unknown as PrismaService;

    service = new StarterTemplatesService(prisma);
  });

  it('returns the dental clinical override pack', async () => {
    tenantFindUnique.mockResolvedValue({ sector: 'dental' });

    const result = await service.getStarterTemplates('tenant-id', 'clinical');

    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-id' },
      select: { sector: true },
    });
    expect(result.items).toHaveLength(6);
    expect(result.items.map((item) => item.id)).toEqual([
      'medical-history-protocol',
      'consent-form-template',
      'safeguarding-pathway',
      'infection-control-guidance',
      'decontamination-protocol',
      'emergency-drugs-reference',
    ]);
  });

  it('falls back to the default pack when the sector has no override', async () => {
    tenantFindUnique.mockResolvedValue({ sector: 'vets' });

    const result = await service.getStarterTemplates('tenant-id', 'hr');

    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.id)).toEqual([
      'staff-handbook',
      'annual-leave-sickness',
      'whistleblowing-complaints',
    ]);
  });

  it('returns an empty CQC pack for sectors without CQC fixtures', async () => {
    tenantFindUnique.mockResolvedValue({ sector: 'physio' });

    await expect(
      service.getStarterTemplates('tenant-id', 'cqc'),
    ).resolves.toEqual({ items: [] });
  });

  it('returns CQC evidence prompts for dental tenants', async () => {
    tenantFindUnique.mockResolvedValue({ sector: 'dental' });

    const result = await service.getStarterTemplates('tenant-id', 'cqc');

    expect(result.items).toHaveLength(5);
    expect(result.items.map((item) => item.id)).toEqual([
      'safe',
      'effective',
      'caring',
      'responsive',
      'well-led',
    ]);
  });

  it('returns the sector-specific CPD framework when one exists', async () => {
    tenantFindUnique.mockResolvedValue({ sector: 'gp' });

    const result = await service.getStarterTemplates('tenant-id', 'cpd');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'gmc-nmc-role-dependent-cpd',
        title: 'GMC / NMC role-dependent CPD',
      }),
    );
  });

  it('falls back to generic CPD for sectors without a CPD override', async () => {
    tenantFindUnique.mockResolvedValue({ sector: 'healthcare' });

    const result = await service.getStarterTemplates('tenant-id', 'cpd');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'continuing-professional-development',
        title: 'Continuing Professional Development',
      }),
    );
  });

  it('throws when the tenant is missing', async () => {
    tenantFindUnique.mockResolvedValue(null);

    await expect(
      service.getStarterTemplates('missing-tenant-id', 'clinical'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when the module value is invalid', async () => {
    await expect(
      service.getStarterTemplates('tenant-id', 'documents'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('throws when the module query is missing', async () => {
    await expect(
      service.getStarterTemplates('tenant-id', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('keeps every fixture file valid and structurally complete', () => {
    const fixturesPath = join(
      process.cwd(),
      'src',
      'starter-templates',
      'fixtures',
    );
    const fixtureFiles = [
      'clinical.json',
      'hr.json',
      'training.json',
      'cqc.json',
      'cpd.json',
    ];

    for (const fixtureFile of fixtureFiles) {
      const parsed = JSON.parse(
        readFileSync(join(fixturesPath, fixtureFile), 'utf8'),
      ) as Record<string, StarterTemplateItem[]>;

      for (const [sector, items] of Object.entries(parsed)) {
        expect(Array.isArray(items)).toBe(true);

        for (const item of items) {
          expect(item).toEqual({
            id: expect.any(String),
            title: expect.any(String),
            summary: expect.any(String),
            body: expect.any(String),
            status: 'template',
          });
          expect(item.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
          expect(item.title.trim()).toBe(item.title);
          expect(item.summary.trim()).toBe(item.summary);
          expect(item.body.trim()).toBe(item.body);
          expect(sector.trim()).toBe(sector);
        }
      }
    }
  });
});
