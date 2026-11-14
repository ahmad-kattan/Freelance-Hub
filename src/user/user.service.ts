import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { ProjectStatus, UserRole } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ListUsersQueryDto } from "./dto/list-users-query.dto.js";
import { buildPaginationMeta } from "../common/utils/pagination.util.js";
import { UpdateMeDto } from "./dto/update-me.dto.js";

const USER_SELECT =
  {
    id: true, name: true, email: true, role: true, isBanned: true, bannedAt: true,
    createdAt: true, updatedAt: true
  } satisfies Prisma.UserSelect;

type CurrentUserInfo = {
  userId: string;
  role: UserRole;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) { }


  async findAll(query: ListUsersQueryDto) {
    const { page, limit, search, sortBy, sortOrder, role, isBanned } = query;

    const where: Prisma.UserWhereInput = {
      ...(role ? { role } : {}),
      ...(isBanned !== undefined ? { isBanned } : {}),
      ...(search
        ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ [sortBy]: sortOrder }, { id: 'desc' }],
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: bigint, current: CurrentUserInfo) {
    if (current.role !== UserRole.ADMIN && current.userId !== id.toString()) {
      throw new ForbiddenException('You can only view your own account');
    }
 
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
 
    if (!user) {
      throw new NotFoundException('User not found');
    }
 
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id: BigInt(userId) },
      data: { name: dto.name },
      select: USER_SELECT,
    });
  }

  async ban(id: bigint, adminId: string) {
    if (id.toString() === adminId) {
      throw new BadRequestException('You cannot ban yourself');
    }
 
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isBanned: true },
    });
 
    if (!target) {
      throw new NotFoundException('User not found');
    }
 
    if (target.role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin accounts cannot be banned');
    }
 
    if (target.isBanned) {
      return this.prisma.user.findUniqueOrThrow({
        where: { id },
        select: USER_SELECT,
      });
    }
 
    const now = new Date();

      return this.prisma.$transaction(async (tx) => {
      const banned = await tx.user.updateMany({
        where: { id, isBanned: false },
        data: { isBanned: true, bannedAt: now },
      });
 
      if (banned.count === 0) {
        return tx.user.findUniqueOrThrow({
          where: { id },
          select: USER_SELECT,
        });
      }
 
      const activeProjects = await tx.project.count({
        where: {
          status: ProjectStatus.IN_PROGRESS,
          deletedAt: null,
          OR: [{ clientId: id }, { acceptedProposal: { freelancerId: id } }],
        },
      });
 
      if (activeProjects > 0) {
        throw new ConflictException(
          `This user has ${activeProjects} project(s) in progress and cannot be banned until they are completed`,
        );
      }
 
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
 
      return tx.user.findUniqueOrThrow({
        where: { id },
        select: USER_SELECT,
      });
    });
  }

  async unban(id: bigint) {
    const user= await this.prisma.user.update({
      where: { id },
      data: { isBanned: false, bannedAt: null },
      select: USER_SELECT,
    });
    if (!user)
    {
      throw new NotFoundException("user Not Found");
    }
    return user;
  }

}