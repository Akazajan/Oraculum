import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CentralizedValidationPipe } from './validation.pipe';
import { runWithRequestContext } from '../context/correlation-context';

class TestUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  firstname!: string;

  @IsString()
  @IsNotEmpty()
  lastname!: string;

  @IsEmail()
  email!: string;
}

class TestSimpleDto {
  @IsNotEmpty()
  required!: string;
}

describe('CentralizedValidationPipe', () => {
  let pipe: CentralizedValidationPipe;

  beforeEach(() => {
    pipe = new CentralizedValidationPipe();
  });

  function callTransform<T>(cls: new () => T, plain: Record<string, unknown>) {
    return pipe.transform(plain, {
      metatype: cls,
      type: 'body',
      data: undefined,
    } as never);
  }

  it('passes valid payloads through untouched', async () => {
    const output = (await callTransform(TestSimpleDto, {
      required: 'hello',
    })) as TestSimpleDto;
    expect(output).toBeInstanceOf(TestSimpleDto);
    expect(output.required).toBe('hello');
  });

  it('returns a structured 400 with a correlationId when validation fails', async () => {
    await runWithRequestContext(
      {
        correlationId: 'cid-test',
        request: { ip: '127.0.0.1', userAgent: 'jest' },
      },
      async () => {
        try {
          await callTransform(TestUserDto, {
            firstname: 'a',
            lastname: '',
            email: 'not-an-email',
          });
          throw new Error('expected a BadRequestException to be thrown');
        } catch (err) {
          const response = (err as Error & {
            getResponse?: () => unknown;
          }).getResponse?.() as Record<string, unknown>;
          expect(response).toMatchObject({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Validation failed',
            correlationId: 'cid-test',
          });
          const fields = response.fields as Array<{
            field: string;
            constraints: string[];
          }>;
          expect(Array.isArray(fields)).toBe(true);
          expect(fields.length).toBeGreaterThan(0);
        }
      },
    );
  });

  it('falls back to correlationId "unknown" when invoked outside a request context', async () => {
    try {
      await callTransform(TestSimpleDto, {});
      throw new Error('expected an exception');
    } catch (err) {
      const response = (err as Error & {
        getResponse?: () => unknown;
      }).getResponse?.() as Record<string, unknown>;
      expect(response).toMatchObject({
        statusCode: 400,
        correlationId: 'unknown',
      });
    }
  });
});
