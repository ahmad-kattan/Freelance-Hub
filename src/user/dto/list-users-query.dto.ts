import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { UserRole } from '../../generated/prisma/enums.js';

export const USER_SORT_FIELDS = ['id', 'name', 'email', 'role', 'createdAt'] as const;

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(USER_SORT_FIELDS)
  sortBy: (typeof USER_SORT_FIELDS)[number] = 'id';

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isBanned?: boolean;
}