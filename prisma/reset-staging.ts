// Staging-only reset: wipe all tenants and create a single ExampleCo
// test tenant, then repoint named admin users to it.
//
// Why this exists: staging accumulated 5 demo tenants (SmileCo / Riverside
// Vets / BrightSight / Greenfield GP / a legacy "Verbilo Dev Tenant") plus
// some hardcoded-prod-URL display bugs that made admin.staging hard to
// reason about. The user wants a single clean test tenant living at
// `exampleco.staging.verbilo.co.uk`.
//
// Idempotent: re-running it ends in the same state regardless of the
// starting point. Safe to run repeatedly during staging fixture churn.
//
// Run (replace placeholders):
//   DATABASE_URL='<staging-neon-url>' \
//   RESET_TENANT_SLUG=exampleco \
//   RESET_TENANT_NAME='ExampleCo' \
//   RESET_ADMIN_USERS='owen.admin,taneesh.admin' \
//   npx ts-node prisma/reset-staging.ts
//
// DO NOT run this against production. Cascade-deletes wipe Sites, Users,
// Patients, Appointments, StaffMembers — i.e. everything tenant-scoped.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_SLUG = process.env.RESET_TENANT_SLUG ?? 'exampleco';
const TENANT_NAME = process.env.RESET_TENANT_NAME ?? 'ExampleCo';
const TENANT_SECTOR =
  (process.env.RESET_TENANT_SECTOR ?? 'healthcare') as
    | 'dental' | 'gp' | 'vets' | 'physio' | 'optometry' | 'other' | 'healthcare';
const SITE_NAMES = (process.env.RESET_SITES ?? 'Main Site').split(',').map(s => s.trim()).filter(Boolean);
const ADMIN_USERNAMES = (process.env.RESET_ADMIN_USERS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set.');
  }

  console.log(`[reset] target slug=${TENANT_SLUG} name="${TENANT_NAME}" sector=${TENANT_SECTOR}`);
  console.log(`[reset] sites: ${SITE_NAMES.join(', ')}`);
  console.log(`[reset] admins to repoint: ${ADMIN_USERNAMES.length ? ADMIN_USERNAMES.join(', ') : '(none)'}`);

  // 1. Upsert ExampleCo + its site(s) first so we have a target before
  //    cascade-deleting the old tenants.
  const target = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    create: {
      slug: TENANT_SLUG,
      name: TENANT_NAME,
      sector: TENANT_SECTOR,
      enabledModules: [],
    },
    update: {
      name: TENANT_NAME,
      sector: TENANT_SECTOR,
    },
  });
  console.log(`[reset] ✓ tenant upserted: id=${target.id} slug=${target.slug}`);

  for (const siteName of SITE_NAMES) {
    const existing = await prisma.site.findFirst({
      where: { tenantId: target.id, name: siteName },
    });
    if (!existing) {
      await prisma.site.create({
        data: { tenantId: target.id, name: siteName },
      });
      console.log(`[reset] ✓ site created: ${siteName}`);
    } else {
      console.log(`[reset] · site already present: ${siteName}`);
    }
  }

  const firstSite = await prisma.site.findFirst({
    where: { tenantId: target.id },
    orderBy: { name: 'asc' },
  });

  // 2. Repoint admin users to ExampleCo BEFORE deleting other tenants —
  //    otherwise the cascade wipes their User rows along with the tenant.
  for (const username of ADMIN_USERNAMES) {
    const updated = await prisma.user.updateMany({
      where: { username },
      data: {
        tenantId: target.id,
        siteId: firstSite?.id ?? null,
      },
    });
    if (updated.count > 0) {
      console.log(`[reset] ✓ repointed user ${username} → ${target.slug} (${updated.count} row${updated.count === 1 ? '' : 's'})`);
    } else {
      console.log(`[reset] · user ${username} not found — skipped (run npm run seed to create)`);
    }
  }

  // 3. Delete every other tenant. FKs on Site/User/Patient/Appointment/
  //    StaffMember are ON DELETE CASCADE, so everything tenant-scoped goes
  //    in one shot.
  const dropped = await prisma.tenant.deleteMany({
    where: { id: { not: target.id } },
  });
  console.log(`[reset] ✓ deleted ${dropped.count} other tenant${dropped.count === 1 ? '' : 's'}`);

  console.log(`[reset] done. Final state: ${TENANT_SLUG} (${TENANT_SECTOR}) with ${SITE_NAMES.length} site(s).`);
}

main()
  .catch((err) => {
    console.error('[reset] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
