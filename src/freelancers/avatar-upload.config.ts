import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
 
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
 
export const avatarMulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB
    files: 1,
  },
 
  fileFilter: (_req: Request,file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return callback(
        new BadRequestException('Only JPEG, PNG and WEBP images are allowed'),
        false,
      );
    }
 
    callback(null, true);
  },
};