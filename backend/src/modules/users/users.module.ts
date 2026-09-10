import { Module } from '@nestjs/common';
import { UsersRepository } from './data/users.repository.js';
import { PasswordService } from './domain/password.service.js';
import { UsersService } from './application/users.service.js';

/**
 * Users module (docs/modules.md §Users).
 *
 * This module owns `users.users` (records + password hash). The Identity
 * module depends on its public service (`UsersService`) to verify
 * credentials and resolve users during session validation.
 *
 * No controllers in this session — user CRUD endpoints land with the Users
 * admin module later.
 */
@Module({
  providers: [PasswordService, UsersRepository, UsersService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
