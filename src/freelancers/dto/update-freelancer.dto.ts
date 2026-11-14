import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  hourlyRate?: number;
}