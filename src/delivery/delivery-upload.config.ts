import { memoryStorage } from 'multer';

export const deliveryMulterOptions = {
  storage: memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,
  },

};