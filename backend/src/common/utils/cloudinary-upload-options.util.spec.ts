import { buildCloudinaryUploadOptions } from './cloudinary-upload-options.util';

describe('buildCloudinaryUploadOptions', () => {
  it('builds responsive image transforms and eager thumbnails', () => {
    const options = buildCloudinaryUploadOptions({
      folder: 'profile-pictures',
      maxWidth: 1200,
      maxHeight: 1200,
      quality: 'auto:good',
      thumbnailWidth: 200,
      thumbnailHeight: 200,
    });

    expect(options.folder).toBe('profile-pictures');
    expect(options.resource_type).toBe('image');
    expect(options.transformation).toEqual([
      { width: 1200, height: 1200, crop: 'limit' },
      { quality: 'auto:good' },
      { fetch_format: 'auto' },
    ]);
    expect(options.eager).toEqual([
      {
        width: 200,
        height: 200,
        crop: 'fill',
        quality: 'auto:good',
        fetch_format: 'auto',
      },
    ]);
  });
});
