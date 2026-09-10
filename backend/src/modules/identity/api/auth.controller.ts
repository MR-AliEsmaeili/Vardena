import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { UsersService } from '../../users/application/users.service.js';
import { AuthenticationService } from '../application/authentication.service.js';
import { AuthGuard } from '../application/auth.guard.js';
import { toUserDto } from '../../users/domain/user.js';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto.js';
import { LoginRequestDto } from './dto/login-request.dto.js';

/**
 * Authentication controller (docs/modules.md §Identity).
 *
 * Transport-only (AR-03): HTTP mapping, DTO validation, Swagger metadata,
 * and cookie injection. No business logic, no Prisma, no password checks
 * live here — they belong to `AuthenticationService`.
 *
 * Endpoints:
 *   POST /api/v1/auth/login   (anonymous — by design)
 *   POST /api/v1/auth/logout  (anonymous, idempotent — safe to call with or without a session)
 *   GET  /api/v1/auth/me      (authenticated)
 *
 * No user CRUD endpoints here — those land with the Users module.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthenticationService,
    private readonly users: UsersService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with username + password and start a session.',
  })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  async login(
    @Body() body: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUserDto> {
    const user = await this.auth.login(body, { req, res });
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Logout is intentionally anonymous (AR-21 exception, documented): the
  // service is safe to call repeatedly with or without a session; applying
  // the auth guard would force clients to be authenticated to end their
  // session, which is wrong (e.g. expired-session replay from a closed tab).
  @ApiOperation({
    summary: 'End the current session (server-side revocation).',
  })
  @ApiNoContentResponse({ description: 'Session revoked (idempotent).' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout({ req, res });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Return the currently authenticated user.' })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({ description: 'Not authenticated.' })
  async me(@Req() req: Request): Promise<AuthenticatedUserDto> {
    const principal = getPrincipal();
    if (principal === undefined) {
      // Belt-and-suspenders: the guard already ensured we have a principal.
      throw AppException.unauthorized('Authentication is required.');
    }
    const user = await this.users.findActiveById(principal.userId);
    if (user === null) {
      // User was disabled between request start and this point — treat as 401.
      throw AppException.unauthorized('Authentication is required.');
    }
    void req;
    return toUserDto(user);
  }
}
