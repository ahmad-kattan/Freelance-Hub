import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { resolve } from 'node:path';
import { Prisma } from '../generated/prisma/client.js';
import { DeliveryStatus, ProjectStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { FileStorageService } from '../common/files/file-storage.service.js';
import { RequestRevisionDto } from './dto/request-revision.dto.js';

const DELIVERY_DIR = resolve(process.cwd(), 'uploads', 'deliveries');

const DELIVERY_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
};

const DELIVERY_SELECT = {
  status: true,
  revisionNote: true,
  reviewedAt: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  submittedAt: true,
  updatedAt: true,
} satisfies Prisma.DeliverySelect;

type DeliveryRow = Prisma.DeliveryGetPayload<{
  select: typeof DELIVERY_SELECT;
}>;

const PARTY_SELECT = {
  clientId: true,
  status: true,
  acceptedProposal: { select: { freelancerId: true, price: true } },
  delivery: { select: { ...DELIVERY_SELECT, filePath: true } },
} satisfies Prisma.ProjectSelect;


@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly files: FileStorageService,
  ) { }


  async upload(projectId: bigint, userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'Delivery file is required (form field name: file)',
      );
    }

    const { project, isFreelancer } = await this.findPartyProject(projectId, userId);

    if (!isFreelancer) {
      throw new ForbiddenException(
        'Only the accepted freelancer can submit the delivery',
      );
    }

    if (project.status !== ProjectStatus.IN_PROGRESS) {
      throw new ConflictException(
        'Deliveries can only be submitted while the project is in progress',
      );
    }

    if (project.delivery && project.delivery.status !== DeliveryStatus.REVISION_REQUESTED) {
      throw new ConflictException(
        'Your delivery is awaiting the client review. You can upload a new file after a revision is requested',
      );
    }

    const saved = await this.files.saveValidated(file, {
      dir: DELIVERY_DIR,
      allowedTypes: DELIVERY_TYPES,
      errorMessage: 'Delivery must be a PDF or a ZIP/RAR/7Z archive',
    });

    const fileData = {
      filePath: saved.storedName,
      originalName: saved.originalName,
      mimeType: saved.mimeType,
      sizeBytes: saved.size,
    };

    try {
      const { delivery, previousFile } = await this.prisma.$transaction(
        async (tx) => {
          const locked = await tx.project.updateMany({
            where: {
              id: projectId,
              status: ProjectStatus.IN_PROGRESS,
              deletedAt: null,
              acceptedProposal: { freelancerId: BigInt(userId) },
            },
            data: { status: ProjectStatus.IN_PROGRESS },
          });

          if (locked.count === 0) {
            throw new ConflictException(
              'Deliveries can only be submitted while the project is in progress',
            );
          }

          const existing = await tx.delivery.findUnique({
            where: { projectId },
            select: { filePath: true, status: true },
          });

          if (!existing) {
            await tx.delivery.create({ data: { projectId, ...fileData } });
          }
          else {
            const replaced = await tx.delivery.updateMany({
              where: { projectId, status: DeliveryStatus.REVISION_REQUESTED },
              data: {
                ...fileData,
                status: DeliveryStatus.SUBMITTED,
                revisionNote: null,
                reviewedAt: null,
                submittedAt: new Date(),
              },
            });

            if (replaced.count === 0) {
              throw new ConflictException(
                'Your delivery is awaiting the client review',
              );
            }
          }

          const current = await tx.delivery.findUniqueOrThrow({
            where: { projectId },
            select: DELIVERY_SELECT,
          });

          return { delivery: current, previousFile: existing?.filePath };
        },
      );

      await this.files.remove(DELIVERY_DIR, previousFile).catch(() => undefined);

      return this.toResponse(projectId, delivery);
    } catch (error) {
      await this.files
        .remove(DELIVERY_DIR, saved.storedName)
        .catch(() => undefined);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A delivery was just submitted for this project');
      }
      throw error;
    }
  }


  async requestRevision(projectId: bigint, clientId: string, dto: RequestRevisionDto) {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: PARTY_SELECT,
      });

      if (!project || project.clientId.toString() !== clientId) {
        throw new NotFoundException('Project not found');
      }

      if (project.status !== ProjectStatus.IN_PROGRESS) {
        throw new ConflictException('This project is not in progress');
      }

      if (!project.delivery) {
        throw new ConflictException('No delivery has been submitted yet');
      }

      if (project.delivery.status !== DeliveryStatus.SUBMITTED) {
        throw new ConflictException('A revision has already been requested for this delivery');
      }

      const locked = await tx.project.updateMany({
        where: {
          id: projectId,
          clientId: BigInt(clientId),
          status: ProjectStatus.IN_PROGRESS,
          deletedAt: null,
        },
        data: { status: ProjectStatus.IN_PROGRESS },
      });

      if (locked.count === 0) {
        throw new ConflictException('This project is no longer in progress');
      }

      const updated = await tx.delivery.updateMany({
        where: { projectId, status: DeliveryStatus.SUBMITTED },
        data: {
          status: DeliveryStatus.REVISION_REQUESTED,
          revisionNote: dto.note,
          reviewedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        throw new ConflictException(
          'This delivery is no longer awaiting review',
        );
      }

      const delivery = await tx.delivery.findUniqueOrThrow({
        where: { projectId },
        select: DELIVERY_SELECT,
      });

      return this.toResponse(projectId, delivery);
    });
  }


  async getDelivery(projectId: bigint, userId: string) {
    const { project } = await this.findPartyProject(projectId, userId);

    if (!project.delivery) {
      throw new NotFoundException('No delivery has been submitted yet');
    }

    return this.toResponse(projectId, project.delivery);
  }


  async getFile(projectId: bigint, userId: string) {
    const { project } = await this.findPartyProject(projectId, userId);

    if (!project.delivery) {
      throw new NotFoundException('No delivery has been submitted yet');
    }

    return {
      filePath: this.files.resolvePath(DELIVERY_DIR, project.delivery.filePath),
      originalName: project.delivery.originalName,
      mimeType: project.delivery.mimeType,
    };
  }

  async approve(projectId: bigint, clientId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: projectId, deletedAt: null },
          select: PARTY_SELECT,
        });

        if (!project || project.clientId.toString() !== clientId) {
          throw new NotFoundException('Project not found');
        }

        if (project.status === ProjectStatus.COMPLETED) {
          throw new ConflictException('This project is already completed');
        }

        if (
          project.status !== ProjectStatus.IN_PROGRESS ||
          !project.acceptedProposal
        ) {
          throw new ConflictException('This project is not in progress');
        }

        if (!project.delivery) {
          throw new ConflictException('No delivery has been submitted yet');
        }

        if (project.delivery.status !== DeliveryStatus.SUBMITTED) {
          throw new ConflictException(
            'The delivery is awaiting a new file from the freelancer',
          );
        }

        const updated = await tx.project.updateMany({
          where: {
            id: projectId,
            clientId: BigInt(clientId),
            status: ProjectStatus.IN_PROGRESS,
            deletedAt: null,
          },
          data: { status: ProjectStatus.COMPLETED },
        });

        if (updated.count === 0) {
          throw new ConflictException('This project is no longer in progress');
        }

        const current = await tx.delivery.findUnique({
          where: { projectId },
          select: { status: true },
        });

        if (!current || current.status !== DeliveryStatus.SUBMITTED) {
          throw new ConflictException('The delivery is not ready for approval');
        }

        const payment = await this.walletService.payout(tx, {
          clientId: BigInt(clientId),
          freelancerId: project.acceptedProposal.freelancerId,
          projectId,
          price: project.acceptedProposal.price,
        });

        return {
          projectId,
          projectStatus: ProjectStatus.COMPLETED,
          paidToFreelancer: payment.earning,
          platformCommission: payment.commission,
          total: payment.price,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Payment for this project was already processed');
      }
      throw error;
    }
  }


  private async findPartyProject(projectId: bigint, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: PARTY_SELECT,
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const isOwner = project.clientId.toString() === userId;
    const isFreelancer = project.acceptedProposal?.freelancerId.toString() === userId;

    if (!isOwner && !isFreelancer) {
      throw new NotFoundException('Project not found');
    }

    return { project, isOwner, isFreelancer };
  }


  private toResponse(projectId: bigint, delivery: DeliveryRow) {
    return {
      status: delivery.status,
      revisionNote: delivery.revisionNote,
      reviewedAt: delivery.reviewedAt,
      name: delivery.originalName,
      mimeType: delivery.mimeType,
      size: delivery.sizeBytes,
      submittedAt: delivery.submittedAt,
      updatedAt: delivery.updatedAt,
      url: `/projects/${projectId}/delivery/file`,
    };
  }
}