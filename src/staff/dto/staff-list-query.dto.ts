import { IsOptional, IsUUID } from 'class-validator';

export class StaffListQueryDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

