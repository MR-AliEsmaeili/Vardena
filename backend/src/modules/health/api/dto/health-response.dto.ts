import { ApiProperty } from '@nestjs/swagger';

/** Response DTOs are the OpenAPI source of truth (ADR-0014). */

export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';

  @ApiProperty({ example: '0.0.0-dev' })
  version: string;

  @ApiProperty({ example: 123 })
  uptimeSeconds: number;
}

export class DatabaseCheckDto {
  @ApiProperty({ example: 'up' })
  database: 'up';
}

export class ReadinessResponseDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';

  @ApiProperty({ example: '0.0.0-dev' })
  version: string;

  @ApiProperty({ type: DatabaseCheckDto })
  checks: DatabaseCheckDto;
}
