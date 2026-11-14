import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export const PROPOSAL_SORT_FIELDS = ['createdAt', 'price'] as const;

export class ListProjectProposalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PROPOSAL_SORT_FIELDS)
  sortBy: (typeof PROPOSAL_SORT_FIELDS)[number] = 'createdAt';
}