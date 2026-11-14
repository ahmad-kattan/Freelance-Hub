import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { memoryStorage } from 'multer';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export const projectAttachmentMulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },

  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return callback(
        new BadRequestException(
          'Attachment must be a JPEG, PNG or WEBP image, or a PDF file',
        ),
        false,
      );
    }

    callback(null, true);
  },
};