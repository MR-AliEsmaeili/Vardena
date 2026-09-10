import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * TEST-ONLY controller exercising the global ValidationPipe through HTTP.
 * It lives in test/ and is imported only by validation e2e specs — it must
 * never be referenced from src/ (it is not a business endpoint).
 */
export class NestedProbeDto {
  @IsString()
  @MinLength(2)
  name: string;
}

export class CreateProbeDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  count: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NestedProbeDto)
  nested?: NestedProbeDto;
}

export class ProbeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

@Controller({ path: 'probe-validation', version: '1' })
export class ValidationProbeController {
  @Post()
  create(@Body() dto: CreateProbeDto): { received: CreateProbeDto } {
    return { received: dto };
  }

  @Get()
  search(@Query() query: ProbeQueryDto): {
    page: number | null;
    pageType: string;
  } {
    return { page: query.page ?? null, pageType: typeof query.page };
  }
}

@Module({ controllers: [ValidationProbeController] })
export class ValidationProbeModule {}
