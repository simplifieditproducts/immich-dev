import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { User, UserAdmin } from 'src/database';
import { SearchStatus, UserAvatarColor, UserMetadataKey, UserStatus } from 'src/enum';
import { UserMetadataItem } from 'src/types';
import {
  Optional,
  PinCode,
  ValidateBoolean,
  ValidateDate,
  ValidateEnum,
  ValidateUUID,
  toEmail,
  toSanitized,
} from 'src/validation';

export class UserUpdateMeDto {
  @Optional()
  @IsEmail({ require_tld: false })
  @Transform(toEmail)
  email?: string;

  // TODO: migrate to the other change password endpoint
  @Optional()
  @IsNotEmpty()
  @IsString()
  password?: string;

  @Optional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ValidateEnum({ enum: UserAvatarColor, name: 'UserAvatarColor', optional: true, nullable: true })
  avatarColor?: UserAvatarColor | null;
}

export class UserResponseDto {
  id!: string;
  name!: string;
  email!: string;
  profileImagePath!: string;
  @ValidateEnum({ enum: UserAvatarColor, name: 'UserAvatarColor' })
  avatarColor!: UserAvatarColor;
  profileChangedAt!: Date;
}

export class UserLicense {
  licenseKey!: string;
  activationKey!: string;
  activatedAt!: Date;
}

const emailToAvatarColor = (email: string): UserAvatarColor => {
  const values = Object.values(UserAvatarColor);
  const randomIndex = Math.floor(
    [...email].map((letter) => letter.codePointAt(0) ?? 0).reduce((a, b) => a + b, 0) % values.length,
  );
  return values[randomIndex];
};

export const mapUser = (entity: User | UserAdmin): UserResponseDto => {
  return {
    id: entity.id,
    email: entity.email,
    name: entity.name,
    profileImagePath: entity.profileImagePath,
    avatarColor: entity.avatarColor ?? emailToAvatarColor(entity.email),
    profileChangedAt: entity.profileChangedAt,
  };
};

export class UserAdminSearchDto {
  @ValidateBoolean({ optional: true })
  withDeleted?: boolean;

  @ValidateUUID({ optional: true })
  id?: string;

  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @ValidateUUID({ optional: true, each: true })
  ids?: string[];

  @Optional()
  @IsString()
  @IsIn(['picturekeeper', 'ultimatebackup'])
  sourceApp?: string;

  @ValidateDate({ optional: true })
  updatedAfter?: Date;
}

export class UserAdminCreateDto {
  @IsEmail({ require_tld: false })
  @Transform(toEmail)
  email!: string;

  @IsString()
  password!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @ValidateEnum({ enum: UserAvatarColor, name: 'UserAvatarColor', optional: true, nullable: true })
  avatarColor?: UserAvatarColor | null;

  @Optional({ nullable: true })
  @IsString()
  @Transform(toSanitized)
  storageLabel?: string | null;

  @Optional({ nullable: true })
  @IsInt()
  @Min(0)
  @ApiProperty({ type: 'integer', format: 'int64' })
  quotaSizeInBytes?: number | null;

  @ValidateBoolean({ optional: true })
  shouldChangePassword?: boolean;

  @ValidateBoolean({ optional: true })
  notify?: boolean;

  @ValidateBoolean({ optional: true })
  isAdmin?: boolean;
}

export class UserAdminUpdateDto {
  @Optional()
  @IsEmail({ require_tld: false })
  @Transform(toEmail)
  email?: string;

  @Optional()
  @IsNotEmpty()
  @IsString()
  password?: string;

  @PinCode({ optional: true, nullable: true, emptyToNull: true })
  pinCode?: string | null;

  @Optional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ValidateEnum({ enum: UserAvatarColor, name: 'UserAvatarColor', optional: true, nullable: true })
  avatarColor?: UserAvatarColor | null;

  @Optional({ nullable: true })
  @IsString()
  @Transform(toSanitized)
  storageLabel?: string | null;

  @ValidateBoolean({ optional: true })
  shouldChangePassword?: boolean;

  @Optional({ nullable: true })
  @IsInt()
  @Min(0)
  @ApiProperty({ type: 'integer', format: 'int64' })
  quotaSizeInBytes?: number | null;

  @ValidateBoolean({ optional: true })
  isAdmin?: boolean;
}

export class UserAdminDeleteDto {
  @ValidateBoolean({ optional: true })
  force?: boolean;
}

export class UserAdminResponseDto extends UserResponseDto {
  storageLabel!: string | null;
  shouldChangePassword!: boolean;
  isAdmin!: boolean;
  createdAt!: Date;
  deletedAt!: Date | null;
  updatedAt!: Date;
  oauthId!: string;
  @ApiProperty({ type: 'integer', format: 'int64' })
  quotaSizeInBytes!: number | null;
  @ApiProperty({ type: 'integer', format: 'int64' })
  quotaUsageInBytes!: number | null;
  @ValidateEnum({ enum: UserStatus, name: 'UserStatus' })
  status!: string;
  license!: UserLicense | null;
}

/** Steps search needs: until they are done for a photo, search doesn't find it. Keyed by QueueName. */
export class UserSearchRequiredRemainingDto {
  /** Photos and videos still without one or more of these steps, each counted once. */
  @ApiProperty({ type: 'integer' })
  assets!: number;
  /** No search vector: text search doesn't find them. */
  @ApiProperty({ type: 'integer' })
  smartSearch!: number;
  /** No metadata yet: date and place filters miss them. */
  @ApiProperty({ type: 'integer' })
  metadataExtraction!: number;
  /** No thumbnail yet: results can't show them. */
  @ApiProperty({ type: 'integer' })
  thumbnailGeneration!: number;
}

/** Steps that may lag: search works without them. Keyed by QueueName. */
export class UserSearchDeferrableRemainingDto {
  /** Photos and videos still without one or more of these steps, each counted once. */
  @ApiProperty({ type: 'integer' })
  assets!: number;
  /** Faces not looked for yet. */
  @ApiProperty({ type: 'integer' })
  faceDetection!: number;
  @ApiProperty({ type: 'integer' })
  ocr!: number;
  /** Videos not transcoded yet. */
  @ApiProperty({ type: 'integer' })
  videoConversion!: number;
  @ApiProperty({ type: 'integer' })
  duplicateDetection!: number;
}

/** The user's photos and videos (not deleted, not hidden) still without each step's result. */
export class UserSearchRemainingDto {
  required!: UserSearchRequiredRemainingDto;
  deferrable!: UserSearchDeferrableRemainingDto;
}

export class UserSearchStatusResponseDto {
  @ValidateEnum({ enum: SearchStatus, name: 'SearchStatus' })
  status!: SearchStatus;
  /** Photos and videos, not deleted, not hidden. */
  @ApiProperty({ type: 'integer' })
  assets!: number;
  remaining!: UserSearchRemainingDto;
  /** When the remaining counts were taken: they are kept up to 30 seconds. */
  countedAt!: Date;
}

export function mapUserAdmin(entity: UserAdmin): UserAdminResponseDto {
  const metadata = entity.metadata || [];
  const license = metadata.find(
    (item): item is UserMetadataItem<UserMetadataKey.License> => item.key === UserMetadataKey.License,
  )?.value;

  return {
    ...mapUser(entity),
    storageLabel: entity.storageLabel,
    shouldChangePassword: entity.shouldChangePassword,
    isAdmin: entity.isAdmin,
    createdAt: entity.createdAt,
    deletedAt: entity.deletedAt,
    updatedAt: entity.updatedAt,
    oauthId: entity.oauthId,
    quotaSizeInBytes: entity.quotaSizeInBytes,
    quotaUsageInBytes: entity.quotaUsageInBytes,
    status: entity.status,
    license: license ? { ...license, activatedAt: new Date(license?.activatedAt) } : null,
  };
}
