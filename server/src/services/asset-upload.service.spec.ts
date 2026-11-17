import { BadRequestException } from '@nestjs/common';
import { StorageCore } from 'src/cores/storage.core';
import { StartUploadDto } from 'src/dtos/asset-upload.dto';
import { AssetType, AssetVisibility } from 'src/enum';
import { AssetUploadService } from 'src/services/asset-upload.service';
import { assetStub } from 'test/fixtures/asset.stub';
import { authStub } from 'test/fixtures/auth.stub';
import { newTestService, ServiceMocks } from 'test/utils';

const startUpload = (livePhotoVideoId?: string) =>
  ({
    assetData: {
      deviceAssetId: 'device-asset-id',
      deviceId: 'device-id',
      filename: 'IMG_0001.HEIC',
      fileCreatedAt: new Date('2026-01-01T00:00:00Z'),
      fileModifiedAt: new Date('2026-01-01T00:00:00Z'),
      livePhotoVideoId,
    },
    checksum: Buffer.from('0123456789abcdef', 'hex'),
    uploadLength: 1024,
  }) as unknown as StartUploadDto;

describe(AssetUploadService.name, () => {
  let sut: AssetUploadService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    StorageCore.setMediaLocation('/data');
    ({ sut, mocks } = newTestService(AssetUploadService));
  });

  describe('onStart', () => {
    it('should start an upload without a live photo video', async () => {
      await expect(sut.onStart(authStub.user1, startUpload())).resolves.toMatchObject({ isDuplicate: false });
      expect(mocks.asset.getById).not.toHaveBeenCalled();
      expect(mocks.asset.createWithMetadata).toHaveBeenCalled();
    });

    it("should reject another user's video as the live photo video", async () => {
      mocks.asset.getById.mockResolvedValue({ ...assetStub.livePhotoMotionAsset, ownerId: 'someone-else' });

      await expect(sut.onStart(authStub.user1, startUpload('video-id'))).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.asset.createWithMetadata).not.toHaveBeenCalled();
    });

    it('should reject a live photo video that is not a video', async () => {
      mocks.asset.getById.mockResolvedValue({
        ...assetStub.livePhotoMotionAsset,
        ownerId: authStub.user1.user.id,
        type: AssetType.Image,
      });

      await expect(sut.onStart(authStub.user1, startUpload('video-id'))).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.asset.createWithMetadata).not.toHaveBeenCalled();
    });

    it("should link and hide the user's own video", async () => {
      mocks.asset.getById.mockResolvedValue({
        ...assetStub.livePhotoMotionAsset,
        ownerId: authStub.user1.user.id,
        visibility: AssetVisibility.Timeline,
      });

      await expect(sut.onStart(authStub.user1, startUpload('video-id'))).resolves.toMatchObject({ isDuplicate: false });
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: 'video-id', visibility: AssetVisibility.Hidden });
      expect(mocks.asset.createWithMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ livePhotoVideoId: 'video-id' }),
        1024,
        undefined,
      );
    });
  });
});
