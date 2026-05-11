import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(64)
  slug!: string;

  @IsString()
  @IsIn(['dental', 'gp', 'vets', 'physio', 'optometry', 'other', 'healthcare'])
  @MaxLength(64)
  sector!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  enabledModules?: string[];
}
