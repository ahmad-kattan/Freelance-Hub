import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

type FieldSchema = {
  type: 'string' | 'integer';
  example?: string | number;
  description?: string;
};

type ApiFileUploadOptions = {
  fileRequired?: boolean;
  fileDescription?: string;
  fields?: Record<string, FieldSchema>;
  requiredFields?: string[];
};

/**
 * يصف طلب multipart/form-data في Swagger (الإضافة لا تفهم حقول الملفات تلقائياً)
 *
 * @ApiFileUpload('avatar')
 * @ApiFileUpload('attachment', { fileRequired: false, fields: { title: { type: 'string' } } })
 */
export function ApiFileUpload(
  fileField: string,
  options: ApiFileUploadOptions = {},
) {
  const {
    fileRequired = true,
    fileDescription,
    fields = {},
    requiredFields = [],
  } = options;

  const required = [...requiredFields, ...(fileRequired ? [fileField] : [])];

  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        
        ...(required.length > 0 ? { required } : {}),
        properties: {
          ...fields,
          [fileField]: {
            type: 'string',
            format: 'binary',
            description: fileDescription,
          },
        },
      },
    }),
  );
}