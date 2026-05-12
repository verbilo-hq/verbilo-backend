import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export class UpdateTenantBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @ValidateIf(
    (_object, value) => typeof value !== 'string' || value.trim() !== '',
  )
  @Matches(HEX_COLOR, {
    message: 'primaryColor must be a 3/4/6/8-digit hex color (with #)',
  })
  primaryColor?: string | null;

  @IsOptional()
  @ValidateIf(
    (_object, value) => typeof value !== 'string' || value.trim() !== '',
  )
  @Matches(HEX_COLOR, {
    message: 'secondaryColor must be a 3/4/6/8-digit hex color (with #)',
  })
  secondaryColor?: string | null;

  @IsOptional()
  @ValidateIf(
    (_object, value) => typeof value !== 'string' || value.trim() !== '',
  )
  @Matches(HEX_COLOR, {
    message: 'accentColor must be a 3/4/6/8-digit hex color (with #)',
  })
  accentColor?: string | null;
}
