import { Expose, Type } from 'class-transformer';

export class UserMeTenantDto {
  @Expose()
  id!: string;

  @Expose()
  name!: string;

  @Expose()
  slug!: string;

  @Expose()
  sector!: string;

  @Expose()
  enabledModules!: string[];
}

export class UserMeSiteDto {
  @Expose()
  id!: string;

  @Expose()
  name!: string;
}

export class UserMeDto {
  @Expose()
  id!: string;

  @Expose()
  username!: string;

  @Expose()
  role!: string;

  @Expose()
  @Type(() => UserMeTenantDto)
  tenant!: UserMeTenantDto | null;

  @Expose()
  @Type(() => UserMeSiteDto)
  site!: UserMeSiteDto | null;
}
