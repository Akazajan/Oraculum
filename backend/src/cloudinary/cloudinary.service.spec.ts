import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

describe('CloudinaryService', () => {
  const mockedUploadStream = cloudinary.uploader.upload_stream as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits progress updates during upload and preserves the final state', async () => {
    const progressUpdates: Array<{ status: string; bytesUploaded: number }> = [];

    mockedUploadStream.mockImplementation((options: unknown, callback: Function) => {
      const stream = {
        write: jest.fn(),
        end: jest.fn(() => callback(null, { secure_url: 'https://example.com/image.jpg' })),
      };
      return stream;
    });

    const service = new CloudinaryService({
      get: jest.fn().mockReturnValue('profile-pictures'),
    } as any);

    const result = await service.uploadImage(
      { buffer: Buffer.from('hello world'), size: 11 } as Express.Multer.File,
      'profile-pictures',
      {
        onProgress: (state) =>
          progressUpdates.push({
            status: state.status,
            bytesUploaded: state.bytesUploaded,
          }),
      },
    );

    expect(progressUpdates[0]?.status).toBe('uploading');
    expect(progressUpdates.at(-1)?.status).toBe('completed');
    expect(result.progress?.status).toBe('completed');
    expect(result.progress?.percent).toBe(100);
  });

  it('marks uploads as interrupted when the stream fails', async () => {
    const progressUpdates: Array<{ status: string; bytesUploaded: number }> = [];

    mockedUploadStream.mockImplementation((options: unknown, callback: Function) => {
      const stream = {
        write: jest.fn(),
        end: jest.fn(() => callback(new Error('socket disconnected'))),
      };
      return stream;
    });

    const service = new CloudinaryService({
      get: jest.fn().mockReturnValue('profile-pictures'),
    } as any);

    await expect(
      service.uploadImage(
        { buffer: Buffer.from('hello world'), size: 11 } as Express.Multer.File,
        'profile-pictures',
        {
          onProgress: (state) =>
            progressUpdates.push({
              status: state.status,
              bytesUploaded: state.bytesUploaded,
            }),
        },
      ),
    ).rejects.toThrow('Upload interrupted');

    expect(progressUpdates.at(-1)?.status).toBe('interrupted');
  });
});
