import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from '../application/health.service.js';
import {
  LivenessResponseDto,
  ReadinessResponseDto,
} from './dto/health-response.dto.js';

/**
 * Transport-only probe controller (AR-03): no logic, no Prisma, no branching.
 * Anonymous by design (documented exception to AR-21: orchestrators cannot
 * authenticate); rate-limit-exempt via the pipeline's skip rule.
 */
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: the API process is running.' })
  @ApiOkResponse({ type: LivenessResponseDto })
  live(): LivenessResponseDto {
    return this.health.checkLiveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe: the API can serve traffic (database reachable).',
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'The database is temporarily unreachable.',
  })
  ready(): Promise<ReadinessResponseDto> {
    return this.health.checkReadiness();
  }
}
