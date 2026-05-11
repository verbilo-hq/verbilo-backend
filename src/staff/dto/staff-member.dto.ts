import { Expose } from 'class-transformer';
import { StaffRole } from '@prisma/client';

export class StaffMemberDto {
  @Expose()
  id!: string;

  @Expose()
  tenantId!: string;

  @Expose()
  siteId!: string | null;

  @Expose()
  userId!: string | null;

  @Expose()
  firstName!: string;

  @Expose()
  surname!: string;

  @Expose()
  email!: string;

  @Expose()
  phone!: string | null;

  @Expose()
  role!: StaffRole;

  @Expose()
  clinicalSpecialty!: string | null;

  @Expose()
  gdcNumber!: string | null;

  @Expose()
  startedAt!: Date | null;

  @Expose()
  endedAt!: Date | null;

  @Expose()
  archivedAt!: Date | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
