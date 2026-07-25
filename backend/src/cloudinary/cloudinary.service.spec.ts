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
      { buffer: Buffer.from('hello world'), originalname: 'avatar.png', size: 11 } as Express.Multer.File,
      'profile-pictures',
    );

    expect(mockedScanUploadedFile).toHaveBeenCalledWith(
      Buffer.from('hello world'),
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
        { buffer: Buffer.from('hello world'), originalname: 'avatar.png', size: 11 } as Express.Multer.File,
        'profile-pictures',
      ),
    ).rejects.toThrow('Upload rejected: suspicious content detected');
  });
});
