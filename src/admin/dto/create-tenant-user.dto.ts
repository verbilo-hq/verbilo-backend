import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { USER_ROLES, type UserRole } from '../../common/user-roles';

export class CreateTenantUserDto {
  @IsString()
  @Matches(/^[a-z0-9._]{3,32}$/)
  username!: string;

  @IsString()
  @Length(1, 80)
  displayName!: string;

  @IsString()
  @IsIn(USER_ROLES)
  role!: UserRole;

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
