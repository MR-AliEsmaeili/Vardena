import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  DocumentBuilder,
  getSchemaPath,
  SwaggerModule,
} from '@nestjs/swagger';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PageQueryDto } from './page-query.dto.js';
import {
  paginatedResponseOf,
  parseSort,
  toOffset,
  toPaginatedResult,
} from './paginated-result.js';

describe('PageQueryDto', () => {
  it('accepts defaults and coerces query strings via the global pipe contract', async () => {
    const query = new PageQueryDto();
    expect(await validate(query)).toEqual([]);
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(100);
  });

  it('rejects out-of-range pages and oversized page sizes', async () => {
    const query = new PageQueryDto();
    query.page = 0;
    query.pageSize = 501;
    const errors = await validate(query);
    expect(errors.map((e) => e.property).sort()).toEqual(['page', 'pageSize']);
  });

  it('validates sort syntax', async () => {
    const valid = new PageQueryDto();
    valid.sort = 'createdAt:desc,name:asc';
    expect(await validate(valid)).toEqual([]);

    const invalid = new PageQueryDto();
    invalid.sort = 'createdAt:sideways;DROP';
    expect(await validate(invalid)).toHaveLength(1);
  });
});

describe('pagination helpers', () => {
  it('builds results, offsets, and parses sort strings', () => {
    expect(toPaginatedResult(['a'], 1, 2, 100)).toEqual({
      items: ['a'],
      total: 1,
      page: 2,
      pageSize: 100,
    });
    expect(toOffset(3, 20)).toEqual({ skip: 40, take: 20 });
    expect(parseSort(undefined)).toEqual([]);
    expect(parseSort('')).toEqual([]);
    expect(parseSort('createdAt:desc,name:asc')).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
  });

  it('gives each paginated OpenAPI DTO a model-specific schema name', () => {
    class UserResponseDto {}
    class WorkflowVersionResponseDto {}

    const PaginatedUserDto = paginatedResponseOf(UserResponseDto);
    const PaginatedWorkflowVersionDto = paginatedResponseOf(
      WorkflowVersionResponseDto,
    );

    expect(PaginatedUserDto.name).toBe('PaginatedUserResponseDto');
    expect(PaginatedWorkflowVersionDto.name).toBe(
      'PaginatedWorkflowVersionResponseDto',
    );
    expect(PaginatedUserDto.name).not.toBe(PaginatedWorkflowVersionDto.name);
  });

  it('publishes each paginated operation with its own item schema', async () => {
    class UserResponseDto {
      @ApiProperty()
      id!: string;
    }
    class WorkflowVersionResponseDto {
      @ApiProperty()
      versionId!: string;
    }

    const PaginatedUserDto = paginatedResponseOf(UserResponseDto);
    const PaginatedWorkflowVersionDto = paginatedResponseOf(
      WorkflowVersionResponseDto,
    );

    @Controller('users')
    @ApiExtraModels(PaginatedUserDto)
    class UsersController {
      @Get()
      @ApiOkResponse({
        schema: { allOf: [{ $ref: getSchemaPath(PaginatedUserDto) }] },
      })
      list() {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
    }

    @Controller('workflow-versions')
    @ApiExtraModels(PaginatedWorkflowVersionDto)
    class WorkflowVersionsController {
      @Get()
      @ApiOkResponse({
        schema: {
          allOf: [{ $ref: getSchemaPath(PaginatedWorkflowVersionDto) }],
        },
      })
      list() {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
    }

    const module = await Test.createTestingModule({
      controllers: [UsersController, WorkflowVersionsController],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('pagination').setVersion('test').build(),
        {
          extraModels: [
            UserResponseDto,
            WorkflowVersionResponseDto,
            PaginatedUserDto,
            PaginatedWorkflowVersionDto,
          ],
        },
      );

      expect(
        document.components?.schemas?.['PaginatedUserResponseDto'],
      ).toMatchObject({
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/UserResponseDto' },
          },
        },
      });
      expect(
        document.components?.schemas?.['PaginatedWorkflowVersionResponseDto'],
      ).toMatchObject({
        properties: {
          items: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/WorkflowVersionResponseDto',
            },
          },
        },
      });
      expect(document.components?.schemas).not.toHaveProperty(
        'PaginatedResponseClass',
      );
    } finally {
      await app.close();
    }
  });

  it('throws on malformed sort entries instead of mistranslating them', () => {
    expect(() => parseSort('createdAt')).toThrow(/Invalid sort entry/);
    expect(() => parseSort('createdAt:sideways')).toThrow(/Invalid sort entry/);
  });
});
