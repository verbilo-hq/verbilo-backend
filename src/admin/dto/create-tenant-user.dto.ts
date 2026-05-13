import {
  IsBoolean,
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

  // VER-74: when true, have Cognito email the invitation directly to
  // the user instead of returning the temp password in the API
  // response. Requires `email` to be set — service throws 400 if not.
  // Defaults to false so existing callers keep getting the password
  // back to show in the modal.
  @IsOptional()
  @IsBoolean()
  sendInvitationEmail?: boolean;
}
