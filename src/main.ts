import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { LoggingInterceptor } from './common/decorators/logging.interceptor.js';
import { ResponseInterceptor } from './common/decorators/response.interceptor.js';
import { AllExceptionsFilter } from './common/decorators/all-exceptions.filter.js';
import { setupSwagger } from './common/swagger/swagger.setup.js';

(BigInt.prototype as any).toJSON = function () { return this.toString(); };
async function bootstrap() {
  
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(process.cwd(), 'uploads','avatars'), { prefix: '/uploads/avatars' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new
      ValidationPipe(
      {
              transform: true,

        whitelist: true,
        forbidNonWhitelisted: true
      }
    )
  );
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  setupSwagger(app);
  
  await app.listen(3000, () => {
    console.log("service started on port 3000");
  });
}
await bootstrap();
