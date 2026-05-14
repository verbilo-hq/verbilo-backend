import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

const STARTER_TEMPLATE_MODULE_IDS = [
  'clinical',
  'hr',
  'training',
  'cpd',
  'cqc',
] as const;

const STARTER_TEMPLATE_MODULE_ID_SET = new Set<string>(
  STARTER_TEMPLATE_MODULE_IDS,
);

type StarterTemplateModuleId = (typeof STARTER_TEMPLATE_MODULE_IDS)[number];

export type StarterTemplateItem = {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: 'template';
};

type StarterTemplateFixture = Record<string, StarterTemplateItem[] | undefined>;

export type StarterTemplateResponse = {
  items: StarterTemplateItem[];
};

@Injectable()
export class StarterTemplatesService {
  private readonly fixturesPath = join(
    process.cwd(),
    'src',
    'starter-templates',
    'fixtures',
  );

  constructor(private readonly prisma: PrismaService) {}

  async getStarterTemplates(
    tenantId: string,
    rawModuleId: string | undefined,
  ): Promise<StarterTemplateResponse> {
    const moduleId = this.readModuleId(rawModuleId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { sector: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const fixture = this.readFixture(moduleId);
    const sectorItems = fixture[tenant.sector];

    if (sectorItems) {
      return { items: sectorItems };
    }

    const defaultItems = fixture.default;

    if (defaultItems) {
      return { items: defaultItems };
    }

    if (moduleId === 'cqc') {
      return { items: [] };
    }

    throw new InternalServerErrorException(
      `Starter templates fixture missing default pack for module "${moduleId}"`,
    );
  }

  private readModuleId(
    rawModuleId: string | undefined,
  ): StarterTemplateModuleId {
    if (!rawModuleId || !STARTER_TEMPLATE_MODULE_ID_SET.has(rawModuleId)) {
      throw new BadRequestException(
        'module must be one of: clinical, hr, training, cpd, cqc',
      );
    }

    return rawModuleId as StarterTemplateModuleId;
  }

  private readFixture(
    moduleId: StarterTemplateModuleId,
  ): StarterTemplateFixture {
    const fixturePath = join(this.fixturesPath, `${moduleId}.json`);

    return JSON.parse(
      readFileSync(fixturePath, 'utf8'),
    ) as StarterTemplateFixture;
  }
}
