import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const ANNOUNCEMENT_VISIBILITY_SCOPES = [
  'company',
  'area',
  'site',
] as const;

export type AnnouncementVisibilityScope =
  (typeof ANNOUNCEMENT_VISIBILITY_SCOPES)[number];

export class CreateAnnouncementDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(5000)
  body!: string;

  @IsString()
  @IsIn(ANNOUNCEMENT_VISIBILITY_SCOPES)
  visibilityScope!: AnnouncementVisibilityScope;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  scopeSiteIds?: string[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
