import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const body = res as { message?: string | string[] };
        if (Array.isArray(body.message)) {
          message = 'Validation failed';
          errors = body.message;
        } else {
          message = body.message ?? exception.message;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': status = 409; message = 'Value already exists'; break;
        case 'P2025': status = 404; message = 'Record not found'; break;
        case 'P2003': status = 409; message = 'Related record constraint violated'; break;
        case 'P2034': status = 409; message = 'Conflict, please retry'; break;
        default:      status = 500; message = 'Database error';
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      ...(errors && { errors }),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}