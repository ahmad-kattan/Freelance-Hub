import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { TransactionType } from '../../generated/prisma/enums.js';

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;
}