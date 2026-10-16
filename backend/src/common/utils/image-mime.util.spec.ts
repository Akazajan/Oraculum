import { BadRequestException } from '@nestjs/common';
import {
  assertAllowedImageMimeType,
  assertFileSize,
  assertAllowedImageFile,
  detectImageMimeType,
  MAX_FILE_SIZE,
} from './image-mime.util';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from('GIF89a\x01\x00', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const PDF = Buffer.from('%PDF-1.7\n');

const file = (buffer: Buffer, mimetype: string, originalname = 'upload') =>
  ({ buffer, mimetype, originalname }) as Express.Multer.File;

describe('detectImageMimeType', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF],
    ['image/webp', WEBP],
  ])('detects %s from its signature', (expected, buffer) => {
    expect(detectImageMimeType(buffer)).toBe(expected);
  });

  it('returns null for content that is not a supported image', () => {
    expect(detectImageMimeType(SVG)).toBeNull();
    expect(detectImageMimeType(PDF)).toBeNull();
    expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('does not treat a RIFF container other than WEBP as an image', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
    ]);
    expect(detectImageMimeType(wav)).toBeNull();
  });
});

describe('assertAllowedImageMimeType', () => {
  it('accepts a file whose declared type matches its content', () => {
    expect(() =>
      assertAllowedImageMimeType(file(PNG, 'image/png', 'avatar.png')),
    ).not.toThrow();
  });

  it('accepts the non-standard image/jpg alias for JPEG content', () => {
    expect(() =>
      assertAllowedImageMimeType(file(JPEG, 'image/jpg', 'avatar.jpg')),
    ).not.toThrow();
  });

  it('rejects a declared type outside the allowlist', () => {
    expect(() =>
      assertAllowedImageMimeType(file(SVG, 'image/svg+xml', 'avatar.svg')),
    ).toThrow(BadRequestException);
  });

  it('rejects non-image content sent with an image extension and type', () => {
    expect(() =>
      assertAllowedImageMimeType(file(PDF, 'image/png', 'avatar.png')),
    ).toThrow(BadRequestException);
  });

  it('rejects content that does not match the declared image type', () => {
    expect(() =>
      assertAllowedImageMimeType(file(GIF, 'image/png', 'avatar.png')),
    ).toThrow(BadRequestException);
  });

  it('rejects a missing file', () => {
    expect(() =>
      assertAllowedImageMimeType(undefined as unknown as Express.Multer.File),
    ).toThrow(BadRequestException);
  });
});

describe('assertFileSize', () => {
  it('accepts a file within the size limit', () => {
    const smallBuffer = Buffer.alloc(1024); // 1KB
    expect(() =>
      assertFileSize(file(smallBuffer, 'image/png', 'avatar.png')),
    ).not.toThrow();
  });

  it('accepts a file exactly at the size limit', () => {
    const exactSizeBuffer = Buffer.alloc(MAX_FILE_SIZE);
    expect(() =>
      assertFileSize(file(exactSizeBuffer, 'image/png', 'avatar.png')),
    ).not.toThrow();
  });

  it('rejects a file exceeding the size limit', () => {
    const largeBuffer = Buffer.alloc(MAX_FILE_SIZE + 1);
    expect(() =>
      assertFileSize(file(largeBuffer, 'image/png', 'avatar.png')),
    ).toThrow(BadRequestException);
  });

  it('rejects a missing file', () => {
    expect(() =>
      assertFileSize(undefined as unknown as Express.Multer.File),
    ).toThrow(BadRequestException);
  });
});

describe('assertAllowedImageFile', () => {
  it('accepts a valid image file within size limit', () => {
    const smallPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() =>
      assertAllowedImageFile(file(smallPng, 'image/png', 'avatar.png')),
    ).not.toThrow();
  });

  it('rejects a file with invalid MIME type', () => {
    const smallPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() =>
      assertAllowedImageFile(file(smallPng, 'image/svg+xml', 'avatar.svg')),
    ).toThrow(BadRequestException);
  });

  it('rejects a file exceeding size limit', () => {
    const largePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_FILE_SIZE + 1),
    ]);
    expect(() =>
      assertAllowedImageFile(file(largePng, 'image/png', 'avatar.png')),
    ).toThrow(BadRequestException);
  });

  it('rejects a file with spoofed MIME type', () => {
    const pdfBuffer = Buffer.from('%PDF-1.7\n');
    expect(() =>
      assertAllowedImageFile(file(pdfBuffer, 'image/png', 'avatar.png')),
    ).toThrow(BadRequestException);
  });
});
