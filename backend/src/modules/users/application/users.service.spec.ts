import { describe, expect, it, vi } from 'vitest';
import type { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import type { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { UsersRepository } from '../data/users.repository.js';
import { PasswordService } from '../domain/password.service.js';
import type { User } from '../domain/user.js';
import { UsersService } from './users.service.js';

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    username: 'alice',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$hashhash',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe('UsersService', () => {
  function build() {
    const passwordService = new PasswordService();
    const repository = {
      findById: vi.fn(),
      findByUsername: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as UsersRepository;
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as JsonLogger;
    const events = {
      on: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as DomainEventBus;
    const service = new UsersService(
      repository,
      passwordService,
      logger,
      events,
    );
    return { service, repository, passwordService, logger, events };
  }

  describe('createUser', () => {
    it('creates a user with an argon2id-hashed password (no plaintext stored)', async () => {
      const { service, repository } = build();
      vi.mocked(repository.findByUsername).mockResolvedValue(null);
      vi.mocked(repository.create).mockImplementation(
        async (input) =>
          makeUser({
            id: input.id,
            username: input.username,
            passwordHash: input.passwordHash,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          }) as any,
      );

      const dto = await service.createUser({
        username: 'bob',
        password: 'hunter2',
      });

      expect(dto.username).toBe('bob');
      expect(dto).not.toHaveProperty('passwordHash');
      expect(dto).not.toHaveProperty('password');
      const createdArg = vi.mocked(repository.create).mock.calls[0]![0] as any;
      expect(createdArg.passwordHash).not.toBe('hunter2');
      expect(createdArg.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('rejects duplicate usernames with Conflict', async () => {
      const { service, repository } = build();
      vi.mocked(repository.findByUsername).mockResolvedValue(makeUser());
      await expect(
        service.createUser({ username: 'alice', password: 'pw' }),
      ).rejects.toMatchObject({ code: 'Conflict' });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects empty username/password', async () => {
      const { service } = build();
      await expect(
        service.createUser({ username: '   ', password: 'pw' }),
      ).rejects.toMatchObject({ code: 'BadRequest' });
      await expect(
        service.createUser({ username: 'u', password: '' }),
      ).rejects.toMatchObject({ code: 'BadRequest' });
    });
  });

  describe('verifyCredentials', () => {
    it('returns user on correct credentials', async () => {
      const { service, repository, passwordService } = build();
      const password = 'correct-horse';
      const hash = await passwordService.hash(password);
      vi.mocked(repository.findByUsername).mockResolvedValue(
        makeUser({ passwordHash: hash }),
      );
      const result = await service.verifyCredentials('alice', password);
      expect(result.user).not.toBeNull();
      expect(result.failureReason).toBeNull();
    });

    it('returns invalid_credentials for unknown user', async () => {
      const { service, repository } = build();
      vi.mocked(repository.findByUsername).mockResolvedValue(null);
      const result = await service.verifyCredentials('nobody', 'pw');
      expect(result.user).toBeNull();
      expect(result.failureReason).toBe('invalid_credentials');
    });

    it('returns invalid_credentials for wrong password', async () => {
      const { service, repository, passwordService } = build();
      vi.mocked(repository.findByUsername).mockResolvedValue(
        makeUser({ passwordHash: await passwordService.hash('right') }),
      );
      const result = await service.verifyCredentials('alice', 'wrong');
      expect(result.user).toBeNull();
      expect(result.failureReason).toBe('invalid_credentials');
    });

    it('returns user_disabled for an inactive user (even with correct password)', async () => {
      const { service, repository, passwordService } = build();
      const password = 'pw';
      vi.mocked(repository.findByUsername).mockResolvedValue(
        makeUser({
          isActive: false,
          passwordHash: await passwordService.hash(password),
        }),
      );
      const result = await service.verifyCredentials('alice', password);
      expect(result.user).toBeNull();
      expect(result.failureReason).toBe('user_disabled');
    });

    it('returns user_disabled for a soft-deleted user', async () => {
      const { service, repository, passwordService } = build();
      const password = 'pw';
      vi.mocked(repository.findByUsername).mockResolvedValue(
        makeUser({
          deletedAt: new Date(),
          passwordHash: await passwordService.hash(password),
        }),
      );
      const result = await service.verifyCredentials('alice', password);
      expect(result.failureReason).toBe('user_disabled');
      expect(result.user).toBeNull();
    });
  });
});
