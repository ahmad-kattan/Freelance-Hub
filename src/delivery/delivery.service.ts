import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { resolve } from 'node:path';
import { Prisma } from '../generated/prisma/client.js';
import { DeliveryStatus, ProjectStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { FileStorageService } from '../common/files/file-storage.service.js';
import { ConfigService } from '@nestjs/config';
import { RequestRevisionDto } from './dto/request-revision.dto.js';
import { calcLateDays, calcLatePenalty } from './late-penalty.util.js';

const DELIVERY_DIR = resolve(process.cwd(), 'uploads', 'deliveries');

const AUTO_APPROVE_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const DELIVERY_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
};

const DELIVERY_SELECT = {
  status: true,
  autoApproved: true,
  firstSubmittedAt: true,
  lateDays: true,
  latePenalty: true,
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
  dueAt: true,
  acceptedProposal: { select: { freelancerId: true, price: true } },
  delivery: { select: { ...DELIVERY_SELECT, filePath: true } },
} satisfies Prisma.ProjectSelect;


@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly files: FileStorageService,
    private readonly config: ConfigService,
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

      return this.toResponse(projectId, delivery, {
        dueAt: project.dueAt,
        price: project.acceptedProposal?.price,
      });
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

      return this.toResponse(projectId, delivery, {
        dueAt: project.dueAt,
        price: project.acceptedProposal?.price,
      });
    });
  }


  async getDelivery(projectId: bigint, userId: string) {
    const { project } = await this.findPartyProject(projectId, userId);

    if (!project.delivery) {
      throw new NotFoundException('No delivery has been submitted yet');
    }

    return this.toResponse(projectId, project.delivery, {
      dueAt: project.dueAt,
      price: project.acceptedProposal?.price,
    });
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

        const payment = await this.settleApproval(tx, {
          projectId,
          clientId: BigInt(clientId),
          freelancerId: project.acceptedProposal.freelancerId,
          price: project.acceptedProposal.price,
          dueAt: project.dueAt,
          firstSubmittedAt: project.delivery.firstSubmittedAt,
          autoApproved: false,
        });

        return {
          projectId,
          projectStatus: ProjectStatus.COMPLETED,
          paidToFreelancer: payment.earning,
          platformCommission: payment.commission,
          lateDays: payment.lateDays,
          latePenalty: payment.penalty,
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



  async autoApproveOverdue(days: number): Promise<number> {
    const threshold = new Date(Date.now() - days * DAY_MS);

    const overdue = await this.prisma.delivery.findMany({
      where: {
        status: DeliveryStatus.SUBMITTED,
        submittedAt: { lte: threshold },
        project: { status: ProjectStatus.IN_PROGRESS, deletedAt: null },
      },
      select: { projectId: true },
      orderBy: { submittedAt: 'asc' },
      take: AUTO_APPROVE_BATCH,
    });

    let approved = 0;

    for (const { projectId } of overdue) {
      try {
        if (await this.autoApproveOne(projectId, threshold)) {
          approved++;
        }
      }
      catch (error) {
        this.logger.error(
          `Auto-approve failed for project ${projectId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return approved;
  }


  private async autoApproveOne(projectId: bigint, threshold: Date): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: projectId, deletedAt: null },
          select: PARTY_SELECT,
        });

        if (
          !project ||
          project.status !== ProjectStatus.IN_PROGRESS ||
          !project.acceptedProposal ||
          !project.delivery ||
          project.delivery.status !== DeliveryStatus.SUBMITTED
        ) {
          return false;
        }

        await this.settleApproval(tx, {
          projectId,
          clientId: project.clientId,
          freelancerId: project.acceptedProposal.freelancerId,
          price: project.acceptedProposal.price,
          dueAt: project.dueAt,
          firstSubmittedAt: project.delivery.firstSubmittedAt,
          autoApproved: true,
          submittedBefore: threshold,
        });

        return true;
      });
    }
    catch (error) {
      if (error instanceof ConflictException) {
        return false;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }


  private async settleApproval(tx: Prisma.TransactionClient,
    params: {
      projectId: bigint; clientId: bigint; freelancerId: bigint; price: bigint;
      dueAt: Date | null; firstSubmittedAt: Date; autoApproved: boolean; submittedBefore?: Date;
    },
  ) {
    const {
      projectId, clientId, freelancerId, price,
      dueAt, firstSubmittedAt, autoApproved, submittedBefore,
    } = params;

    const lateDays = calcLateDays(dueAt, firstSubmittedAt);
    const { perDay, max } = this.penaltyConfig();
    const penalty = calcLatePenalty(price, lateDays, perDay, max);

    const updated = await tx.project.updateMany({
      where: {
        id: projectId,
        clientId,
        status: ProjectStatus.IN_PROGRESS,
        deletedAt: null,
      },
      data: { status: ProjectStatus.COMPLETED },
    });

    if (updated.count === 0) {
      throw new ConflictException('This project is no longer in progress');
    }

    const deliveryUpdated = await tx.delivery.updateMany({
      where: {
        projectId,
        status: DeliveryStatus.SUBMITTED,
        ...(submittedBefore && { submittedAt: { lte: submittedBefore } }),
      },
      data: {
        status: DeliveryStatus.APPROVED,
        autoApproved,
        reviewedAt: new Date(),
        lateDays,
        latePenalty: penalty,
      },
    });

    if (deliveryUpdated.count === 0) {
      throw new ConflictException('The delivery is not ready for approval');
    }

    const payment = await this.walletService.payout(tx, { clientId, freelancerId, projectId, price, penalty });

    return { ...payment, lateDays };
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


  private penaltyConfig() {
    return {
      perDay: this.config.get<number>('LATE_PENALTY_PERCENT_PER_DAY', 5),
      max: this.config.get<number>('LATE_PENALTY_MAX_PERCENT', 30),
    };
  }


  private resolveLateness(delivery: DeliveryRow, ctx: { dueAt: Date | null; price?: bigint }
  ) {
    if (delivery.status === DeliveryStatus.APPROVED) {
      return { lateDays: delivery.lateDays, latePenalty: delivery.latePenalty };
    }

    const lateDays = calcLateDays(ctx.dueAt, delivery.firstSubmittedAt);
    const { perDay, max } = this.penaltyConfig();
    const latePenalty = ctx.price === undefined? 0n
        : calcLatePenalty(ctx.price, lateDays, perDay, max);
    return { lateDays, latePenalty };
  }


  private toResponse(projectId: bigint,delivery: DeliveryRow,
    ctx: { dueAt: Date | null; price?: bigint },
  ) {
    const { lateDays, latePenalty } = this.resolveLateness(delivery, ctx);

    return {
      status: delivery.status,
      autoApproved: delivery.autoApproved,
      revisionNote: delivery.revisionNote,
      reviewedAt: delivery.reviewedAt,
      name: delivery.originalName,
      mimeType: delivery.mimeType,
      size: delivery.sizeBytes,
      firstSubmittedAt: delivery.firstSubmittedAt,
      submittedAt: delivery.submittedAt,
      lateDays,
      latePenalty,
      updatedAt: delivery.updatedAt,
      url: `/projects/${projectId}/delivery/file`,
    };
  }
}