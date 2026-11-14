import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateProfileDto } from './dto/update-freelancer.dto.js';

const AVATAR_DIR = resolve(process.cwd(), 'uploads', 'avatars');
const AVATAR_URL_PREFIX = '/uploads/avatars/';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PROFILE_SELECT = {
  userId: true,
  bio: true,
  hourlyRate: true,
  avatarPath: true,
  updatedAt: true,
  user: { select: { name: true } },
} satisfies Prisma.FreelancerProfileSelect;

type ProfileRow = Prisma.FreelancerProfileGetPayload<{ select: typeof PROFILE_SELECT }>;

@Injectable()
export class FreelancersService {
  constructor(private readonly prisma: PrismaService) { }


  async getPublicProfile(id: bigint) {
    const profile = await this.prisma.freelancerProfile.findFirst({
      where: { userId: id, user: { isBanned: false } },
      select: PROFILE_SELECT,
    });

    if (!profile) {
      throw new NotFoundException('Freelancer not found');
    }


    return this.toResponse(profile);
  }


  async getMyProfile(userId: string) {
    const id = BigInt(userId);

    const profile = await this.prisma.freelancerProfile.upsert({
      where: { userId: id },
      create: { userId: id },
      update: {},
      select: PROFILE_SELECT,
    });

    return this.toResponse(profile);
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    const id = BigInt(userId);
    
    const data = {
      bio: dto.bio !== undefined ? dto.bio : undefined,
      hourlyRate: dto.hourlyRate !== undefined ? BigInt(dto.hourlyRate)
       : undefined,
    };

    const profile = await this.prisma.freelancerProfile.upsert({
      where: { userId: id },
      create: { userId: id, ...data },
      update: data,
      select: PROFILE_SELECT,
    });

    return this.toResponse(profile);
  }


  async updateAvatar(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'Avatar image is required (form field name: avatar)',
      );
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    const extension = detected ? ALLOWED_TYPES[detected.mime] : undefined;

    if (!extension) {
      throw new BadRequestException(
        'Only JPEG, PNG and WEBP images are allowed',
      );
    }


    const filename = `${randomUUID()}.${extension}`;
    const newAvatarPath = `${AVATAR_URL_PREFIX}${filename}`;

    await mkdir(AVATAR_DIR, { recursive: true });

    await writeFile(resolve(AVATAR_DIR, filename), file.buffer, { flag: 'wx' });

    const id = BigInt(userId);

    const existing = await this.prisma.freelancerProfile.findUnique({
      where: { userId: id },
      select: { avatarPath: true },
    });

    let profile: ProfileRow;
    try {
      profile = await this.prisma.freelancerProfile.upsert({
        where: { userId: id },
        create: { userId: id, avatarPath: newAvatarPath },
        update: { avatarPath: newAvatarPath },
        select: PROFILE_SELECT,
      });
    } catch (error) {
      await this.removeAvatarFile(newAvatarPath).catch(() => undefined);
      throw error;
    }

    await this.removeAvatarFile(existing?.avatarPath).catch(() => undefined);

    return this.toResponse(profile);
  }

  async deleteAvatar(userId: string) {
    const id = BigInt(userId);

    const existing = await this.prisma.freelancerProfile.findUnique({
      where: { userId: id },
      select: { avatarPath: true },
    });

    if (!existing?.avatarPath) {
      return {
        message: 'No avatar to delete',
      };
    }

    await this.prisma.freelancerProfile.update({
      where: { userId: id },
      data: { avatarPath: null },
    });

    await this.removeAvatarFile(existing.avatarPath).catch(() => undefined);

    return {
      message: 'Avatar deleted successfully',
    };
  }

  private toResponse(profile: ProfileRow) {
    return {
      id: profile.userId,
      name: profile.user.name,
      bio: profile.bio,
      hourlyRate: profile.hourlyRate,
      avatarUrl: profile.avatarPath,
      updatedAt: profile.updatedAt,
    };
  }

  private async removeAvatarFile(avatarPath?: string | null): Promise<void> {
    if (!avatarPath?.startsWith(AVATAR_URL_PREFIX)) return;

    const filename = basename(avatarPath);
    if (!filename || filename === '.' || filename === '..') return;

    try {
      await unlink(resolve(AVATAR_DIR, filename));
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
}
