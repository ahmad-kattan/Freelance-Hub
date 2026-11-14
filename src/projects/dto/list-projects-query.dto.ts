import { Matches, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export const PROJECT_SORT_FIELDS = ['createdAt', 'budget'] as const;

export class ListProjectsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Matches(/^\d{1,18}$/, { message: 'categoryId must be a positive integer' })
  categoryId?: string;

  @IsOptional()
  @IsIn(PROJECT_SORT_FIELDS)
  sortBy: (typeof PROJECT_SORT_FIELDS)[number] = 'createdAt';
}