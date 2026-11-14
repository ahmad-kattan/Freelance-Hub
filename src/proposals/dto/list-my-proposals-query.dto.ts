import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ProposalStatus } from '../../generated/prisma/enums.js';

export class ListMyProposalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ProposalStatus)
  status?: ProposalStatus;
}