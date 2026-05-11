import { IsIn, IsString } from 'class-validator';
import { USER_ROLES } from '../../common/user-roles';
import type { UserRole } from '../../common/user-roles';

export class UpdateTenantUserDto {
  @IsString()
  @IsIn(USER_ROLES)
  role!: UserRole;
}
