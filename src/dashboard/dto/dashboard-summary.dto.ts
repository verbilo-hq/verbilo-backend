import { Expose, Type } from 'class-transformer';

export class DashboardRecentActivityDto {
  @Expose()
  id!: string;

  @Expose()
  action!: string;

  @Expose()
  entityType!: string;

  @Expose()
  entityId!: string | null;

  @Expose()
  createdAt!: Date;
}

export class DashboardSummaryDto {
  @Expose()
  patientCount!: number;

  @Expose()
  todaysAppointments!: number;

  @Expose()
  openTasks!: number;

  @Expose()
  @Type(() => DashboardRecentActivityDto)
  recentActivity!: DashboardRecentActivityDto[];
}

