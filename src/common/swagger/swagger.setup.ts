import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

const DESCRIPTION = [
  'Backend API for FreelanceHub: a platform that connects clients with freelancers and protects both sides with an escrow wallet.',
  '',
  '## Conventions (read first)',
  '',
  '**Responses.** Every successful response is `{ "success": true, "data": ... }`. Lists also include `"meta"`: `{ total, page, limit, totalPages, hasNextPage, hasPreviousPage }`.',
  '',
  '**Errors.** `{ "success": false, "statusCode": 400, "message": "...", "errors": [...], "timestamp": "...", "path": "..." }`. `errors` appears only for validation failures (HTTP 400).',
  '',
  '**IDs are strings.** Database IDs are 64-bit integers, returned as strings (for example `"12"`). When an ID is sent in a body or query (for example `categoryId`), send it as a string too.',
  '',
  '**Money is in cents.** All amounts are integers in US cents: `50000` means $500.00. Requests send integers; responses return them as strings (for example `"50000"`). The currency is always USD.',
  '',
  '**Dates** are ISO 8601 in UTC.',
  '',
  '## Authentication',
  '',
  'Call `POST /auth/login`, then send `Authorization: Bearer <access_token>` on protected endpoints. The access token lasts 15 minutes; renew it with `POST /auth/refresh` (each refresh token can be used once; reusing one revokes every session of the user).',
  '',
  '## Rate limits',
  '',
  'Login: 5 attempts per minute. Everything else: 100 requests per minute per IP. Exceeding a limit returns HTTP 429.',
  '',
  '## File uploads',
  '',
  'Uploads use `multipart/form-data`. Field names: `avatar` (profile picture, up to 2 MB), `attachment` (project attachment, up to 5 MB), `file` (delivery, up to 10 MB). The real file type is checked from the file content, not its extension.',
].join('\n');

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('FreelanceHub API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Register, login, token refresh and device sessions')
    .addTag('Users', 'Account data and bans (admin)')
    .addTag('Freelancers', 'Freelancer profiles and profile pictures')
    .addTag('Categories', 'Project categories (managed by the admin)')
    .addTag('Projects', 'Publishing, browsing and managing projects')
    .addTag('Proposals', 'Freelancer proposals and accepting one')
    .addTag('Wallet', 'Balance, top-ups and the transaction ledger')
    .addTag('Delivery', 'Submitting work, revisions, approval and payment')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  fixBigIntParams(document);

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, 
    },
  });
}

// معاملات المسار من نوع bigint (مثل :id) لا يعرفها Swagger فيعرضها كـ object.
// نحوّلها إلى نص رقمي ليظهر الحقل كصندوق نص عادي.
function fixBigIntParams(document: OpenAPIObject) {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem as Record<string, any>)) {
      for (const param of operation?.parameters ?? []) {
        const schema = param?.schema;
        const isBigInt =
          String(schema?.$ref ?? '').endsWith('/BigInt') ||
          schema?.type === 'BigInt' ||
          schema?.type === 'bigint';

        if (isBigInt) {
          param.schema = { type: 'string', pattern: '^[0-9]+$', example: '1' };
        }
      }
    }
  }

  const schemas = (document.components as any)?.schemas;
  if (schemas) delete schemas['BigInt'];
}