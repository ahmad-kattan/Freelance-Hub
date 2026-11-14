import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ProjectStatus } from '../../generated/prisma/enums.js';

export class ListMyProjectsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}