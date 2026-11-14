import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @Matches(/^\d{1,18}$/, { message: 'categoryId must be a positive integer' })
  categoryId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  budget: number;
}