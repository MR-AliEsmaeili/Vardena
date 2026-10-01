import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { LicensingService } from '../application/licensing.service.js';

@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@Controller({ path: 'license', version: '1' })
export class LicenseStateController {
  constructor(private readonly licensing: LicensingService) {}

  /** Authenticated self/bootstrap read; no RBAC permission is required. */
  @Get('current')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Current installation license capability state.' })
  @ApiOkResponse({ description: 'Non-secret evaluated license state.' })
  async current(): Promise<{
    status: string;
    active: boolean;
    inactiveReason: string | null;
    validFrom: string;
    validUntil: string | null;
    organizationLimit: number | null;
    userLimit: number | null;
    entitlements: Array<{ kind: string; code: string }>;
    provider: string;
  }> {
    const license = await this.licensing.current();
    return {
      status: license.status,
      active: license.active,
      inactiveReason: license.inactiveReason,
      validFrom: license.validFrom.toISOString(),
      validUntil: license.validUntil?.toISOString() ?? null,
      organizationLimit: license.organizationLimit,
      userLimit: license.userLimit,
      entitlements: license.entitlements.map(({ kind, code }) => ({
        kind,
        code,
      })),
      provider: license.provider,
    };
  }
}
