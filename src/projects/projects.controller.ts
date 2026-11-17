import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto.js';
import { ListMyProjectsQueryDto } from './dto/list-my-projects-query.dto.js';
import { projectAttachmentMulterOptions } from './project-attachment-upload.config.js';
import { Auth } from '../common/decorators/auth.decorator.js';
import { CurrentUser } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ParseBigIntPipe } from '../common/decorators/parsebigIntpipe.js';
import type { AuthUser } from '../common/type/auth-user.type.js';
import { contentDisposition } from '../common/utils/content-disposition.util.js';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFileUpload } from '../common/decorators/api-file-upload.decorator.js';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) { }

  @Post()
  @Auth(UserRole.CLIENT)
  @UseInterceptors(
    FileInterceptor('attachment', projectAttachmentMulterOptions))
  @ApiOperation({
    summary: 'Publish a project (clients only)',
    description:
      'multipart/form-data. budget is an integer in cents (50000 = $500.00). categoryId is a string (400 if the category does not exist). The optional attachment is an image (JPEG, PNG, WEBP) or a PDF, up to 5 MB; its real type is checked from the content. The new project starts as OPEN.',
  })
  @ApiFileUpload('attachment', {
    fileRequired: false,
    fileDescription: 'Optional. JPEG, PNG, WEBP or PDF, up to 5 MB',
    fields: {
      title: { type: 'string', example: 'Design a logo for my shop' },
      description: { type: 'string', example: 'I need a modern logo...' },
      categoryId: { type: 'string', example: '1' },
      budget: { type: 'integer', example: 20000 },
    },
    requiredFields: ['title', 'description', 'categoryId', 'budget'],
  })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateProjectDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.projectsService.create(userId, dto, file);
  }

  @Get()
  @Auth(UserRole.FREELANCER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Browse open projects (freelancers)',
    description:
      'Only OPEN, non-deleted projects of non-banned clients. Paginated (always check meta.total and meta.totalPages). Filters: search (in the title), categoryId. Sort by createdAt (newest) or budget with sortOrder.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: [
          {
            id: '5',
            title: 'Design a logo for my shop',
            budget: '20000',
            status: 'OPEN',
            createdAt: '2026-11-13T10:00:00.000Z',
            category: { id: '2', name: 'تصميم' },
            client: { id: '3', name: 'Sara' },
          },
        ],
        meta: {
          total: 42,
          page: 1,
          limit: 10,
          totalPages: 5,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  findAll(@Query() query: ListProjectsQueryDto) {
    return this.projectsService.findAll(query);
  }

  @Get('mine')
  @Auth(UserRole.CLIENT)
  @ApiOperation({
    summary: 'My projects (clients)',
    description:
      'All my non-deleted projects in every status (OPEN, IN_PROGRESS, COMPLETED). Optional filter: status.',
  })
  findMine(
    @CurrentUser('userId') userId: string,
    @Query() query: ListMyProjectsQueryDto,
  ) {
    return this.projectsService.findMine(userId, query);
  }

  @Get(':id/attachment')
  @Auth()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Download a project attachment',
    description:
      'Returns the file itself (not JSON), with the original file name. Allowed for everyone who can see the project. 404 if the project has no attachment.',
  })
  async downloadAttachment(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser() user: AuthUser,
  ) {
    const file = await this.projectsService.getAttachment(id, user);

    try {
      await access(file.filePath);
    } catch {
      throw new NotFoundException('Attachment file not found');
    }

    return new StreamableFile(createReadStream(file.filePath), {
      type: file.mimeType,
      disposition: contentDisposition(file.originalName),
    });
  }

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'Project details',
    description:
      'Visible to: the owner and admins always; freelancers while the project is OPEN, or if their proposal was accepted. Everyone else gets 404 (the project is hidden, not forbidden). The attachment field has the download url when a file exists.',
  })
  findOne(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.findOne(id, user);
  }

  @Patch(':id')
  @Auth(UserRole.CLIENT)
  @UseInterceptors(
    FileInterceptor('attachment', projectAttachmentMulterOptions),
  )
  @ApiOperation({
    summary: 'Edit my project (owner, only while OPEN)',
    description:
      'Send only what you want to change. Plain JSON also works when you are not replacing the attachment. A new attachment replaces the old one. 400 for an empty request, 403 if not yours, 409 if the project is no longer OPEN.',
  })
  @ApiFileUpload('attachment', {
    fileRequired: false,
    fileDescription: 'Optional new attachment (replaces the old one)',
    fields: {
      title: { type: 'string' },
      description: { type: 'string' },
      categoryId: { type: 'string', example: '1' },
      budget: { type: 'integer', example: 20000 },
    },
  })
  update(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProjectDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.projectsService.update(id, userId, dto, file);
  }

  @Delete(':id')
  @Auth(UserRole.CLIENT)
  @ApiOperation({
    summary: 'Delete my project (owner, only while OPEN)',
    description:
      'Soft delete: the project disappears from the platform but is kept in the database. 403 if not yours, 409 if the project is no longer OPEN.',
  })
  remove(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser('userId') userId: string,
  ) {
    return this.projectsService.remove(id, userId);
  }
}