export interface CloudinaryUploadOptions {
  folder?: string;
  resourceType?: 'image' | 'video' | 'raw' | 'auto';
  maxWidth?: number;
  maxHeight?: number;
  quality?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}

export function buildCloudinaryUploadOptions({
  folder,
  resourceType = 'image',
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 'auto:good',
  thumbnailWidth,
  thumbnailHeight,
}: CloudinaryUploadOptions = {}) {
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
