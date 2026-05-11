// Seed script — populates the database with a handful of representative
// tenants across multiple sectors so local dev and staging never look
// dental-only (VER-47), and optionally pairs a Cognito-backed user to
// one of them.
//
// Run with `npm run seed` against a populated `DATABASE_URL` env var.
//
// Always-run: upserts the demo tenants below (idempotent by slug).
// Optional: if `SEED_USERNAME` and `SEED_COGNITO_SUB` are set, also
// upserts a User row paired to that tenant (default: SmileCo). Use
// `SEED_TENANT_SLUG` to pair to a different tenant — e.g. for testing
// a vet practice flow.

import { PrismaClient } from '@prisma/client';
import { normalizeSlug } from '../src/common/slug';

const prisma = new PrismaClient();

type Sector =
  | 'dental'
  | 'gp'
  | 'vets'
  | 'physio'
  | 'optometry'
  | 'other'
  | 'healthcare';

type SeedTenant = {
  slug: string;
  name: string;
  sector: Sector;
  sites: string[];
};

const DEMO_TENANTS: SeedTenant[] = [
  {
    slug: 'smileco',
    name: 'SmileCo Dental Group',
    sector: 'dental',
    sites: ['London Flagship', 'Manchester Central'],
  },
  {
    slug: 'riverside-vets',
    name: 'Riverside Vets',
    sector: 'vets',
    sites: ['Riverside Main Clinic', 'Riverside Emergency Hours'],
  },
  {
    slug: 'brightsight',
    name: 'BrightSight Opticians',
    sector: 'optometry',
    sites: ['BrightSight High Street'],
  },
  {
    slug: 'greenfield-gp',
    name: 'Greenfield GP Federation',
    sector: 'gp',
    sites: ['Greenfield North', 'Greenfield East'],
  },
];

async function upsertDemoTenant(t: SeedTenant) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: t.slug },
    create: {
      slug: t.slug,
      name: t.name,
      sector: t.sector,
      enabledModules: [],
    },
    update: {
      name: t.name,
      sector: t.sector,
    },
  });

  for (const siteName of t.sites) {
    const existing = await prisma.site.findFirst({
      where: { tenantId: tenant.id, name: siteName },
    });
    if (!existing) {
      await prisma.site.create({
        data: { tenantId: tenant.id, name: siteName },
      });
    }
  }

  return tenant;
}

async function seedCognitoUser(targetSlug: string) {
  const username = process.env.SEED_USERNAME;
  const cognitoSub = process.env.SEED_COGNITO_SUB;
  if (!username || !cognitoSub) {
    console.log(
      '[seed] SEED_USERNAME / SEED_COGNITO_SUB not set — skipping user pairing.',
    );
    return;
  }

  const tenant =
    (await prisma.tenant.findUnique({ where: { slug: targetSlug } })) ??
    (await prisma.tenant.findFirst());

  if (!tenant) {
    throw new Error('No tenant available to pair the user to.');
  }

  const site = await prisma.site.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { name: 'asc' },
  });

  const user = await prisma.user.upsert({
    where: { cognitoId: cognitoSub },
    update: {
      username,
      tenantId: tenant.id,
      siteId: site?.id ?? null,
    },
    create: {
      username,
      cognitoId: cognitoSub,
      tenantId: tenant.id,
      siteId: site?.id ?? null,
    },
  });

  console.log(
    `[seed] ✓ user paired: id=${user.id} → ${tenant.slug} (${tenant.sector})`,
  );
}

async function maybeSeedFromLegacyEnv() {
  // Backward compat with the pre-VER-47 seed flow: if SEED_TENANT_NAME is
  // set, ensure that exact tenant exists too. Useful for staging deploys
  // that pin a specific tenant slug via env.
  const tenantName = process.env.SEED_TENANT_NAME;
  if (!tenantName) return null;
  const slug = normalizeSlug(tenantName) || 'verbilo-dev-tenant';
  const siteName = process.env.SEED_SITE_NAME ?? 'Dev Site';

  const existing = await prisma.tenant.findFirst({
    where: { OR: [{ name: tenantName }, { slug }] },
  });
  const tenant = existing
    ? await prisma.tenant.update({
        where: { id: existing.id },
        data: { name: tenantName, slug },
      })
    : await prisma.tenant.create({
        data: { name: tenantName, slug, sector: 'healthcare' },
      });

  const existingSite = await prisma.site.findFirst({
    where: { name: siteName, tenantId: tenant.id },
  });
  if (!existingSite) {
    await prisma.site.create({
      data: { name: siteName, tenantId: tenant.id },
    });
  }
  console.log(`[seed] ✓ legacy env tenant: ${tenant.slug}`);
  return tenant.slug;
}

async function main() {
  console.log(`[seed] upserting ${DEMO_TENANTS.length} demo tenants…`);
  for (const t of DEMO_TENANTS) {
    const tenant = await upsertDemoTenant(t);
    console.log(
      `[seed] ✓ ${tenant.slug.padEnd(20)} (${tenant.sector.padEnd(10)}) ${tenant.name}`,
    );
  }

  const legacySlug = await maybeSeedFromLegacyEnv();
  const targetSlug = legacySlug ?? process.env.SEED_TENANT_SLUG ?? 'smileco';
  await seedCognitoUser(targetSlug);

  console.log('[seed] done.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
