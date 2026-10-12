import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { LicensingService } from '../application/licensing.service.js';
import { LicenseStateDto } from './dto/license.dto.js';
import { toLicenseStateView } from './license-state.view.js';

@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@Controller({ path: 'license', version: '1' })
export class LicenseStateController {
  constructor(private readonly licensing: LicensingService) {}

  /** Authenticated self/bootstrap read; no RBAC permission is required. */
  @Get('current')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Current installation license capability state.',
    description:
      'Evaluates the persisted installation license on every call. An installation that has never activated a license answers status UNLICENSED with active=false; it is a state read, never an activation.',
  })
  @ApiOkResponse({
    type: LicenseStateDto,
    description: 'Non-secret evaluated license state.',
  })
  async current(): Promise<LicenseStateDto> {
    const snapshot = await this.licensing.currentState();
    return toLicenseStateView(snapshot.license, snapshot.versions);
  }
}
