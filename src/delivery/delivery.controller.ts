import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { DeliveryService } from './delivery.service.js';
import { deliveryMulterOptions } from './delivery-upload.config.js';
import { Auth } from '../common/decorators/auth.decorator.js';
import { CurrentUser } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ParseBigIntPipe } from '../common/decorators/parsebigIntpipe.js';
import { RequestRevisionDto } from './dto/request-revision.dto.js';
import { contentDisposition } from '../common/utils/content-disposition.util.js';
import {  ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFileUpload } from '../common/decorators/api-file-upload.decorator.js';


@ApiTags('Delivery')
@Controller('projects/:projectId/delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  // PUT /projects/:projectId/delivery   
  @Put()
  @Auth(UserRole.FREELANCER)
  @UseInterceptors(FileInterceptor('file', deliveryMulterOptions))
  @ApiOperation({
    summary: 'Submit the delivery (accepted freelancer)',
    description:
      'multipart/form-data with the file in the field named file. PDF, ZIP, RAR or 7Z, up to 10 MB (the real type is checked from the content). Allowed only while the project is IN_PROGRESS and only for the freelancer whose proposal was accepted. The first submission has status SUBMITTED. While it is SUBMITTED (waiting for the client) it cannot be replaced: 409. After the client requests a revision you upload a new file, which becomes SUBMITTED again.',
  })
  @ApiFileUpload('file', {
    fileDescription: 'PDF, ZIP, RAR or 7Z, up to 10 MB',
  })
  upload(@Param('projectId', ParseBigIntPipe) projectId: bigint,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.deliveryService.upload(projectId, userId, file);
  }

  // GET /projects/:projectId/delivery   
  @Get()
  @Auth()
  @ApiOperation({
    summary: 'Delivery details (the two parties only)',
    description:
      'status is SUBMITTED or REVISION_REQUESTED. When a revision was requested, revisionNote contains what the client wants changed. Anyone who is not the project owner or the accepted freelancer gets 404.',
  })
  getDelivery(
    @Param('projectId', ParseBigIntPipe) projectId: bigint,
    @CurrentUser('userId') userId: string,
  ) {
    return this.deliveryService.getDelivery(projectId, userId);
  }

  // GET /projects/:projectId/delivery/file   
  @Get('file')
  @Auth()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Download the delivery file (the two parties only)',
    description:
      'Returns the file itself (not JSON). Delivery files are private: nobody else can open them.',
  })
  async downloadFile(
    @Param('projectId', ParseBigIntPipe) projectId: bigint,
    @CurrentUser('userId') userId: string,
  ) {
    const file = await this.deliveryService.getFile(projectId, userId);

    try {
      await access(file.filePath);
    } catch {
      throw new NotFoundException('Delivery file not found');
    }
    return new StreamableFile(createReadStream(file.filePath), {
      type: file.mimeType,
      disposition: contentDisposition(file.originalName),
    });
  }

  // POST /projects/:projectId/delivery/request-revision   
  @Post('request-revision')
  @HttpCode(200)
  @Auth(UserRole.CLIENT)
   @ApiOperation({
    summary: 'Ask for changes (project owner only)',
    description:
      'Rejects the current file and tells the freelancer what to change (note is required). The delivery becomes REVISION_REQUESTED and the freelancer can upload a new file. No money moves. 409 if there is no delivery yet or a revision was already requested.',
  })
  requestRevision( @Param('projectId', ParseBigIntPipe) projectId: bigint,
    @CurrentUser('userId') userId: string,
    @Body() dto: RequestRevisionDto,
  ) {
    return this.deliveryService.requestRevision(projectId, userId, dto);
  }

  // POST /projects/:projectId/delivery/approve  
  @Post('approve')
  @HttpCode(200)
  @Auth(UserRole.CLIENT)
  @ApiOperation({
    summary: 'Approve the delivery and pay (project owner only)',
    description:
      'One atomic operation: the reserved amount leaves the client, 90% goes to the freelancer wallet and 10% to the platform wallet, and the project becomes COMPLETED. Pressing the button twice pays only once (the second call returns 409). 409 also when there is no delivery or it is waiting for a new file.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          projectId: '5',
          projectStatus: 'COMPLETED',
          paidToFreelancer: '18000',
          platformCommission: '2000',
          total: '20000',
        },
      },
    },
  })
  approve(
    @Param('projectId', ParseBigIntPipe) projectId: bigint,
    @CurrentUser('userId') userId: string,
  ) {
    return this.deliveryService.approve(projectId, userId);
  }
}


