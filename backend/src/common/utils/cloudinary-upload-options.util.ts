export interface CloudinaryUploadOptions {
  folder?: string;
  resourceType?: 'image' | 'video' | 'raw' | 'auto';
  maxWidth?: number;
  maxHeight?: number;
  quality?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}

/** B19 – Cloudinary accepts exactly these resource types at runtime. */
const SUPPORTED_RESOURCE_TYPES = new Set(['image', 'video', 'raw', 'auto']);

export function buildCloudinaryUploadOptions({
  folder,
  resourceType = 'image',
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 'auto:good',
  thumbnailWidth,
  thumbnailHeight,
}: CloudinaryUploadOptions = {}) {
  if (!SUPPORTED_RESOURCE_TYPES.has(resourceType)) {
    throw new Error(
      `Unsupported Cloudinary resource_type: "${resourceType}"`,
    );
  }
  return {
    folder: folder || 'uploads',
    resource_type: resourceType,
    transformation: [
      { width: maxWidth, height: maxHeight, crop: 'limit' },
      { quality },
      { fetch_format: 'auto' },
    ],
    eager: thumbnailWidth || thumbnailHeight
      ? [
          {
            width: thumbnailWidth || maxWidth,
            height: thumbnailHeight || maxHeight,
            crop: 'fill',
            quality,
            fetch_format: 'auto',
          },
        ]
      : undefined,
  };
}
