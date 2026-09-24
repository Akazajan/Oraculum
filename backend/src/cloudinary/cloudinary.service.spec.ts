import { BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';
import { scanUploadedFile } from '../common/utils/malware-scanner.util';

jest.mock('cloudinary', () => ({
  v2: {
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

jest.mock('../common/utils/malware-scanner.util', () => ({
  scanUploadedFile: jest.fn(),
}));

const mockedScanUploadedFile = scanUploadedFile as jest.MockedFunction<typeof scanUploadedFile>;

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('CloudinaryService', () => {
  const mockedUploadStream = cloudinary.uploader.upload_stream as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scans uploads before sending them to Cloudinary', async () => {
    mockedScanUploadedFile.mockResolvedValue({ isClean: true, scanned: true });
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

    await service.uploadImage(
      { buffer: PNG_BYTES, originalname: 'avatar.png', mimetype: 'image/png', size: PNG_BYTES.length } as Express.Multer.File,
      'profile-pictures',
    );

    expect(mockedScanUploadedFile).toHaveBeenCalledWith(
      PNG_BYTES,
      'avatar.png',
      expect.anything(),
    );
  });

  it('rejects uploads when the scanner detects a threat', async () => {
    mockedScanUploadedFile.mockRejectedValue(new Error('Upload rejected: suspicious content detected'));

    const service = new CloudinaryService({
      get: jest.fn().mockReturnValue('profile-pictures'),
    } as any);

    await expect(
      service.uploadImage(
        { buffer: PNG_BYTES, originalname: 'avatar.png', mimetype: 'image/png', size: PNG_BYTES.length } as Express.Multer.File,
        'profile-pictures',
      ),
    ).rejects.toThrow('Upload rejected: suspicious content detected');
  });

  it('rejects a disallowed MIME type before scanning or uploading', async () => {
    const service = new CloudinaryService({
      get: jest.fn().mockReturnValue('profile-pictures'),
    } as any);

    await expect(
      service.uploadImage(
        { buffer: Buffer.from('<svg></svg>'), originalname: 'avatar.svg', mimetype: 'image/svg+xml', size: 11 } as Express.Multer.File,
        'profile-pictures',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockedScanUploadedFile).not.toHaveBeenCalled();
    expect(mockedUploadStream).not.toHaveBeenCalled();
  });

  it('rejects a spoofed extension whose content is not an image', async () => {
    const service = new CloudinaryService({
      get: jest.fn().mockReturnValue('profile-pictures'),
    } as any);

    await expect(
      service.uploadImage(
        { buffer: Buffer.from('%PDF-1.7'), originalname: 'avatar.png', mimetype: 'image/png', size: 8 } as Express.Multer.File,
        'profile-pictures',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockedUploadStream).not.toHaveBeenCalled();
  });
});
