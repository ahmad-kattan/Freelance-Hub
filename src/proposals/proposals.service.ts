import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ProjectStatus, ProposalStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { buildPaginationMeta } from '../common/utils/pagination.util.js';
import { CreateProposalDto } from './dto/create-proposal.dto.js';
import { ListProjectProposalsQueryDto } from './dto/list-project-proposals-query.dto.js';
import { ListMyProposalsQueryDto } from './dto/list-my-proposals-query.dto.js';


const CREATED_SELECT = {
  id: true,
  projectId: true,
  price: true,
  durationDays: true,
  message: true,
  status: true,
  createdAt: true,
} satisfies Prisma.ProposalSelect;

const OWNER_LIST_SELECT = {
  id: true,
  price: true,
  durationDays: true,
  message: true,
  status: true,
  createdAt: true,
  freelancer: {
    select: {
      id: true,
      name: true,
      freelancerProfile: { select: { hourlyRate: true, avatarPath: true } },
    },
  },
} satisfies Prisma.ProposalSelect;

type OwnerListRow = Prisma.ProposalGetPayload<{
  select: typeof OWNER_LIST_SELECT;
}>;

const MY_LIST_SELECT = {
  id: true,
  price: true,
  durationDays: true,
  message: true,
  status: true,
  createdAt: true,
  project: {
    select: {
      id: true,
      title: true,
      status: true,
      budget: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.ProposalSelect;

type MyListRow = Prisma.ProposalGetPayload<{ select: typeof MY_LIST_SELECT }>;

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) { }


  async create(projectId: bigint, freelancerId: string, dto: CreateProposalDto) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { clientId: true, status: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.clientId.toString() === freelancerId) {
      throw new ForbiddenException(
        'You cannot submit a proposal on your own project',
      );
    }

    if (project.status !== ProjectStatus.OPEN) {
      throw new ConflictException(
        'This project is no longer open for proposals',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const stillOpen = await tx.project.updateMany({
          where: { id: projectId, status: ProjectStatus.OPEN, deletedAt: null },
          data: { status: ProjectStatus.OPEN },
        });

        if (stillOpen.count === 0) {
          throw new ConflictException(
            'This project is no longer open for proposals',
          );
        }

        return tx.proposal.create({
          data: {
            projectId,
            freelancerId: BigInt(freelancerId),
            price: BigInt(dto.price),
            durationDays: dto.durationDays,
            message: dto.message,
          },
          select: CREATED_SELECT,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'You have already submitted a proposal for this project',
        );
      }
      throw error;
    }
  }


  async listForProject(projectId: bigint, ownerId: string, query: ListProjectProposalsQueryDto) {
    const { page, limit, sortBy, sortOrder } = query;

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { clientId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.clientId.toString() !== ownerId) {
      throw new ForbiddenException('You can only view proposals on your own projects');
    }

    const where: Prisma.ProposalWhereInput = {
      projectId,
      freelancer: { isBanned: false },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.proposal.findMany({
        where,
        select: OWNER_LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ [sortBy]: sortOrder }, { id: 'desc' }],
      }),
      this.prisma.proposal.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toOwnerItem(row)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }


  async listMine(freelancerId: string, query: ListMyProposalsQueryDto) {
    const { page, limit, status, sortOrder } = query;

    const where: Prisma.ProposalWhereInput = {
      freelancerId: BigInt(freelancerId),
      ...(status ? { status } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.proposal.findMany({
        where,
        select: MY_LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: sortOrder }, { id: 'desc' }],
      }),
      this.prisma.proposal.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toMyItem(row)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }


  async accept(proposalId: bigint, clientId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const proposal = await tx.proposal.findUnique({
          where: { id: proposalId },
          select: {
            id: true,
            projectId: true,
            price: true,
            status: true,
            freelancer: { select: { isBanned: true ,id:true} },
            project: {
              select: { clientId: true, status: true, deletedAt: true },
            },
          },
        });

        if (!proposal || proposal.project.deletedAt !== null) {
          throw new NotFoundException('Proposal not found');
        }

        if (proposal.project.clientId.toString() !== clientId) {
          throw new ForbiddenException(
            'You can only accept proposals on your own projects',
          );
        }

        if (proposal.project.status !== ProjectStatus.OPEN) {
          throw new ConflictException('This project is no longer open');
        }

        if (proposal.status !== ProposalStatus.PENDING) {
          throw new ConflictException('This proposal is no longer pending');
        }

        if (proposal.freelancer.isBanned) {
          throw new ConflictException('This freelancer is no longer available');
        }
        
        const stillActive = await tx.user.updateMany({
          where: { id: BigInt(proposal.freelancer.id), isBanned: false },
          data: { isBanned: false },
        });
        if (stillActive.count === 0)
           throw new ConflictException('This freelancer is no longer available');


        const projectUpdate = await tx.project.updateMany({
          where: {
            id: proposal.projectId,
            clientId: BigInt(clientId),
            status: ProjectStatus.OPEN,
            deletedAt: null,
          },
          data: {
            status: ProjectStatus.IN_PROGRESS,
            acceptedProposalId: proposal.id,
          },
        });

        if (projectUpdate.count === 0) {
          throw new ConflictException('This project is no longer open');
        }

        await this.walletService.hold(tx, BigInt(clientId), proposal.projectId, proposal.price);

        const accepted = await tx.proposal.updateMany({
          where: { id: proposal.id, status: ProposalStatus.PENDING },
          data: { status: ProposalStatus.ACCEPTED },
        });

        if (accepted.count !== 1) {
          throw new ConflictException('This proposal is no longer pending');
        }

        await tx.proposal.updateMany({
          where: {
            projectId: proposal.projectId,
            id: { not: proposal.id },
            status: ProposalStatus.PENDING,
          },
          data: { status: ProposalStatus.REJECTED },
        });

        return {
          proposalId: proposal.id,
          projectId: proposal.projectId,
          proposalStatus: ProposalStatus.ACCEPTED,
          projectStatus: ProjectStatus.IN_PROGRESS,
          heldAmount: proposal.price,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This project already has an accepted proposal');
      }
      throw error;
    }
  }


  private toOwnerItem(row: OwnerListRow) {
    return {
      id: row.id,
      price: row.price,
      durationDays: row.durationDays,
      message: row.message,
      status: row.status,
      createdAt: row.createdAt,
      freelancer: {
        id: row.freelancer.id,
        name: row.freelancer.name,
        hourlyRate: row.freelancer.freelancerProfile?.hourlyRate ?? null,
        avatarUrl: row.freelancer.freelancerProfile?.avatarPath ?? null,
      },
    };
  }

  private toMyItem(row: MyListRow) {
    return {
      id: row.id,
      price: row.price,
      durationDays: row.durationDays,
      message: row.message,
      status: row.status,
      createdAt: row.createdAt,
      project: {
        id: row.project.id,
        title: row.project.title,
        status: row.project.status,
        budget: row.project.budget,
        isDeleted: row.project.deletedAt !== null,
      },
    };
  }
}