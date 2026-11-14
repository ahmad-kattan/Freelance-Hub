import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Prisma } from '../generated/prisma/client.js';
import { ProjectStatus, UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginationMeta } from '../common/utils/pagination.util.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto.js';
import { ListMyProjectsQueryDto } from './dto/list-my-projects-query.dto.js';
import { AuthUser } from '../common/type/auth-user.type.js';

const PROJECT_FILES_DIR = resolve(process.cwd(), 'uploads', 'projects');

const ATTACHMENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};


const LIST_SELECT = {
  id: true,
  title: true,
  budget: true,
  status: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
} satisfies Prisma.ProjectSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  updatedAt: true,
  clientId: true,
  attachmentPath: true,
  attachmentOriginalName: true,
  attachmentMimeType: true,
  attachmentSize: true,
  acceptedProposal: { select: { freelancerId: true } },
} satisfies Prisma.ProjectSelect;

type DetailRow = Prisma.ProjectGetPayload<{ select: typeof DETAIL_SELECT }>;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) { }


  async create(userId: string, dto: CreateProjectDto, file?: Express.Multer.File) {
    const categoryId = BigInt(dto.categoryId);
    await this.assertCategoryExists(categoryId);

    const attachment = file ? await this.saveAttachment(file) : undefined;

    try {
      const project = await this.prisma.project.create({
        data: {
          clientId: BigInt(userId),
          categoryId,
          title: dto.title,
          description: dto.description,
          budget: BigInt(dto.budget),
          ...attachment,
        },
        select: DETAIL_SELECT,
      });

      return this.toDetail(project);
    } catch (error) {

      if (attachment) {
        await this.removeFile(attachment.attachmentPath).catch(() => undefined);
      }
      throw error;
    }
  }

  async findAll(query: ListProjectsQueryDto) {
    const { page, limit, search, categoryId, sortBy, sortOrder } = query;

    const where: Prisma.ProjectWhereInput = {
      status: ProjectStatus.OPEN,
      deletedAt: null,
      ...(categoryId ? { categoryId: BigInt(categoryId) } : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        select: LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ [sortBy]: sortOrder }, { id: 'desc' }],
      }),
      this.prisma.project.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }


  async findMine(userId: string, query: ListMyProjectsQueryDto) {
    const { page, limit, status, sortOrder } = query;

    const where: Prisma.ProjectWhereInput = {
      clientId: BigInt(userId),
      deletedAt: null,
      ...(status ? { status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        select: LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: sortOrder }, { id: 'desc' }],
      }),
      this.prisma.project.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }


  async findOne(id: bigint, current: AuthUser) {
    const project = await this.findVisible(id, current);
    return this.toDetail(project);
  }



  async getAttachment(id: bigint, current: AuthUser) {
    const project = await this.findVisible(id, current);

    if (!project.attachmentPath) {
      throw new NotFoundException('This project has no attachment');
    }

    return {
      filePath: resolve(PROJECT_FILES_DIR, basename(project.attachmentPath)),
      originalName: project.attachmentOriginalName ?? 'attachment',
      mimeType: project.attachmentMimeType ?? 'application/octet-stream',
    };
  }

  async update(id: bigint, userId: string, dto: UpdateProjectDto, file?: Express.Multer.File,
  ) {
    const hasChanges = dto.title !== undefined || dto.description !== undefined || dto.categoryId !== undefined || dto.budget !== undefined;

    if (!hasChanges && !file) {
      throw new BadRequestException('Nothing to update');
    }

    const existing = await this.getOwnedOpenProject(id, userId);

    const categoryId = dto.categoryId !== undefined ? BigInt(dto.categoryId) : undefined;
    if (categoryId !== undefined) {
      await this.assertCategoryExists(categoryId);
    }

    const attachment = file ? await this.saveAttachment(file) : undefined;

    const data: Prisma.ProjectUncheckedUpdateManyInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(dto.budget !== undefined ? { budget: BigInt(dto.budget) } : {}),
      ...attachment,
    };

    try {
      const result = await this.prisma.project.updateMany({
        where: {
          id,
          clientId: BigInt(userId),
          status: ProjectStatus.OPEN,
          deletedAt: null,
        },
        data,
      });

      if (result.count === 0) {
        throw new ConflictException('Only open projects can be modified');
      }
    } catch (error) {
      if (attachment) {
        await this.removeFile(attachment.attachmentPath).catch(() => undefined);
      }
      throw error;
    }

    if (attachment) {
      await this.removeFile(existing.attachmentPath).catch(() => undefined);
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      select: DETAIL_SELECT,
    });

    return this.toDetail(project);
  }

  async remove(id: bigint, userId: string) {
    await this.getOwnedOpenProject(id, userId);

    const result = await this.prisma.project.updateMany({
      where: {
        id,
        clientId: BigInt(userId),
        status: ProjectStatus.OPEN,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new ConflictException('Only open projects can be deleted');
    }

    return { message: 'Project deleted successfully' };
  }


  private async findVisible(id: bigint, current: AuthUser) {
    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      select: DETAIL_SELECT,
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const isOwner = project.clientId.toString() === current.userId;
    const isAdmin = current.role === UserRole.ADMIN;
    const isAcceptedFreelancer = project.acceptedProposal?.freelancerId.toString() === current.userId;
    const isOpenForFreelancer =
      current.role === UserRole.FREELANCER &&
      project.status === ProjectStatus.OPEN;

    if (!isOwner && !isAdmin && !isAcceptedFreelancer && !isOpenForFreelancer) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  private async getOwnedOpenProject(id: bigint, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      select: { clientId: true, status: true, attachmentPath: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.clientId.toString() !== userId) {
      throw new ForbiddenException('You can only modify your own projects');
    }

    if (project.status !== ProjectStatus.OPEN) {
      throw new ConflictException('Only open projects can be modified');
    }

    return project;
  }

  private async assertCategoryExists(categoryId: bigint) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException('Category not found');
    }
  }


  private toDetail(project: DetailRow) {
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      budget: project.budget, // بالسنت
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      category: project.category,
      client: project.client,
      attachment: project.attachmentPath
        ? {
          name: project.attachmentOriginalName,
          mimeType: project.attachmentMimeType,
          size: project.attachmentSize,
          url: `/projects/${project.id}/attachment`,
        }
        : null,
    };
  }


  private async saveAttachment(file: Express.Multer.File) {

    const detected = await fileTypeFromBuffer(file.buffer);
    const extension = detected ? ATTACHMENT_TYPES[detected.mime] : undefined;

    if (!detected || !extension) {
      throw new BadRequestException(
        'Attachment must be a JPEG, PNG or WEBP image, or a PDF file',
      );
    }

    const filename = `${randomUUID()}.${extension}`;

    await mkdir(PROJECT_FILES_DIR, { recursive: true });
    await writeFile(resolve(PROJECT_FILES_DIR, filename), file.buffer, {
      flag: 'wx',
    });

    return {
      attachmentPath: filename, 
      attachmentOriginalName: this.cleanFileName(file.originalname),
      attachmentMimeType: detected.mime,
      attachmentSize: file.buffer.length,
    };
  }

  private async removeFile(filename?: string | null): Promise<void> {
    if (!filename) return;

    const safeName = basename(filename);
    if (!safeName || safeName === '.' || safeName === '..') return;

    try {
      await unlink(resolve(PROJECT_FILES_DIR, safeName));
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  private cleanFileName(originalName: string): string {
    let name = originalName;
    const alreadyUnicode = [...name].some((ch) => ch.charCodeAt(0) > 0xff);
    if (!alreadyUnicode) {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      if (!decoded.includes('\uFFFD')) name = decoded;
    }

    const cleaned = basename(name)
      .replace(/[\u0000-\u001f"\\/]+/g, '_')
      .slice(0, 255);

    return cleaned || 'attachment';
  }
}