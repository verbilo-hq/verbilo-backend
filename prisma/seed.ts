import { PrismaClient } from '@prisma/client';
import { normalizeSlug } from '../src/common/slug';

const prisma = new PrismaClient();

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? 'Verbilo Dev Tenant';
  const tenantSlug = normalizeSlug(tenantName) || 'verbilo-dev-tenant';
  const siteName = process.env.SEED_SITE_NAME ?? 'Dev Site';
  const username = requiredEnv('SEED_USERNAME');
  const cognitoSub = requiredEnv('SEED_COGNITO_SUB');

  const existingTenant = await prisma.tenant.findFirst({
    where: { OR: [{ name: tenantName }, { slug: tenantSlug }] },
  });
  const tenant = existingTenant
    ? await prisma.tenant.update({
        where: { id: existingTenant.id },
        data: { name: tenantName, slug: tenantSlug },
      })
    : await prisma.tenant.create({
        data: { name: tenantName, slug: tenantSlug },
      });

  const existingSite = await prisma.site.findFirst({
    where: {
      name: siteName,
      tenantId: tenant.id,
    },
  });
  const site = existingSite
    ? await prisma.site.update({
        where: { id: existingSite.id },
        data: {
          name: siteName,
          tenantId: tenant.id,
        },
      })
    : await prisma.site.create({
        data: {
          name: siteName,
          tenantId: tenant.id,
        },
      });

  const user = await prisma.user.upsert({
    where: { cognitoId: cognitoSub },
    update: {
      username,
      tenantId: tenant.id,
      siteId: site.id,
    },
    create: {
      username,
      cognitoId: cognitoSub,
      tenantId: tenant.id,
      siteId: site.id,
    },
  });

  console.log(
    `Seed complete: user=${user.id}, tenant=${tenant.id}, site=${site.id}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
