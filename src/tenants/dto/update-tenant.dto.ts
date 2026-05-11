import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['dental', 'gp', 'vets', 'physio', 'optometry', 'other', 'healthcare'])
  @MaxLength(64)
  sector?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  enabledModules?: string[];

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
