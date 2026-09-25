import { BadRequestException } from '@nestjs/common';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

// Some clients still send the non-standard `image/jpg`.
const MIME_ALIASES: Record<string, AllowedImageMimeType> = {
  'image/jpg': 'image/jpeg',
};

const startsWith = (buffer: Buffer, signature: number[], offset = 0) =>
  buffer.length >= offset + signature.length &&
  signature.every((byte, i) => buffer[offset + i] === byte);

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/**
 * Identifies the image type from the file's magic bytes. The client-supplied
 * mimetype and extension are not trusted.
 */
export function detectImageMimeType(
  buffer: Buffer,
): AllowedImageMimeType | null {
  if (!buffer) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (
    startsWith(buffer, ascii('GIF87a')) ||
    startsWith(buffer, ascii('GIF89a'))
  ) {
    return 'image/gif';
  }
  if (
    startsWith(buffer, ascii('RIFF')) &&
    startsWith(buffer, ascii('WEBP'), 8)
  ) {
    return 'image/webp';
  }
  return null;
}

export function assertAllowedImageMimeType(file: Express.Multer.File): void {
  if (!file?.buffer) {
    throw new BadRequestException('No file uploaded');
  }

  const declared = (file.mimetype || '').toLowerCase();
  const normalized = MIME_ALIASES[declared] ?? declared;
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)) {
    throw new BadRequestException(
      `Unsupported file type. Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
    );
  }

  if (detectImageMimeType(file.buffer) !== normalized) {
    throw new BadRequestException(
      'File content does not match its declared type',
    );
  }
}
