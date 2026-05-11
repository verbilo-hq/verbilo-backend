import { IsString, MaxLength } from 'class-validator';

export class TenantSlugQueryDto {
  @IsString()
  @MaxLength(64)
  slug!: string;
}

