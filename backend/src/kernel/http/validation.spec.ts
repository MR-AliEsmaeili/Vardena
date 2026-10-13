import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createValidationPipe, flattenValidationErrors } from './validation.js';

describe('flattenValidationErrors', () => {
  it('flattens constraints and nested children to dotted paths', () => {
    const child = {
      property: 'quantity',
      constraints: { min: 'quantity must not be less than 1' },
    } as ValidationError;

    const root = { property: 'lines', children: [child] } as ValidationError;

    const title = {
      property: 'title',
      constraints: {
        isString: 'title must be a string',
        minLength: 'title is too short',
      },
    } as ValidationError;

    expect(flattenValidationErrors([root, title])).toEqual([
      {
        field: 'lines.quantity',
        code: 'min',
        message: 'quantity must not be less than 1',
      },
      { field: 'title', code: 'isString', message: 'title must be a string' },
      { field: 'title', code: 'minLength', message: 'title is too short' },
    ]);
  });
});

describe('createValidationPipe', () => {
  it('creates a ValidationPipe instance', () => {
    expect(createValidationPipe()).toBeInstanceOf(ValidationPipe);
  });
});
