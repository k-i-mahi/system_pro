import { cloudinary } from '../config/cloudinary.js';
import { env } from '../config/env.js';

interface UploadResult {
  publicId: string;
  secureUrl: string;
}

export async function uploadFile(
  filePath: string,
  folder: string
): Promise<UploadResult> {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `${env.CLOUDINARY_UPLOAD_FOLDER}/${folder}`,
    resource_type: 'auto',
  });

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
  };
}

export async function deleteFile(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
