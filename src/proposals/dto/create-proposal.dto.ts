import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateProposalDto {
    @IsInt()
    @Min(1)
    @Max(1_000_000_000)
    price: number;

    @IsInt()
    @Min(1)
    @Max(3650)
    durationDays: number;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @IsNotEmpty()
    @MaxLength(1000)
    message: string;
}