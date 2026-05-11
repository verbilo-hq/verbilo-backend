-- 1. Tenant.sector default
ALTER TABLE "Tenant" ALTER COLUMN "sector" SET DEFAULT 'healthcare';

-- 2. Rename Appointment.dentistId column + its FK constraint + the index implicitly maintained
ALTER TABLE "Appointment" RENAME COLUMN "dentistId" TO "practitionerId";
ALTER TABLE "Appointment" RENAME CONSTRAINT "Appointment_dentistId_fkey" TO "Appointment_practitionerId_fkey";

-- 3. StaffMember.clinicalSpecialty
ALTER TABLE "StaffMember" ADD COLUMN "clinicalSpecialty" TEXT;

-- 4. StaffRole enum — recreate with new values.
-- There's no production data with these enum values yet (staff CRUD just landed),
-- and dropping/recreating is cleaner than chaining ALTER TYPE RENAME VALUE for
-- the four values that don't have 1:1 mappings.
ALTER TYPE "StaffRole" RENAME TO "StaffRole_old";
CREATE TYPE "StaffRole" AS ENUM ('admin', 'manager', 'clinician', 'clinical_support', 'reception', 'admin_support');
-- Map any existing rows. If staging has rows with old values, this expression
-- routes them to the closest generic role.
ALTER TABLE "StaffMember"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE "StaffRole" USING (
    CASE "role"::text
      WHEN 'admin' THEN 'admin'
      WHEN 'manager' THEN 'manager'
      WHEN 'dentist' THEN 'clinician'
      WHEN 'hygienist' THEN 'clinician'
      WHEN 'nurse' THEN 'clinical_support'
      WHEN 'receptionist' THEN 'reception'
      ELSE 'admin_support'
    END::"StaffRole"
  );
-- NOTE: We intentionally leave "clinicalSpecialty" NULL for migrated rows. The old
-- role labels (dentist/hygienist/etc) are no longer available after the type cast
-- above, so preserving them would require a separate pre-cast UPDATE.
UPDATE "StaffMember"
  SET "clinicalSpecialty" = CASE
    WHEN "clinicalSpecialty" IS NULL THEN NULL
    ELSE "clinicalSpecialty"
  END;
DROP TYPE "StaffRole_old";
