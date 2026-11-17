import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

const CATEGORIES_CACHE_KEY = 'categories:all';

const CATEGORIES_TTL_MS = 10 * 60 * 1000;

const CATEGORY_SELECT = {
  id: true,
  name: true,
} satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject (CACHE_MANAGER) private readonly cache: Cache,
  ) { }


  async findAll() {
    const cached = await this.cache.get<ReturnType<typeof this.toResponse>[]>(
      CATEGORIES_CACHE_KEY,
    );

    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const categories = await this.prisma.category.findMany({
      select: CATEGORY_SELECT,
      orderBy: { name: 'asc' },
    });

    const result = categories.map((category) => this.toResponse(category));

    await this.cache.set(CATEGORIES_CACHE_KEY, result, CATEGORIES_TTL_MS);

    return result;
  }

  async create(dto: CreateCategoryDto) {

    await this.assertNameAvailable(dto.name);
    try {
      const category = await this.prisma.category.create({
        data: { name: dto.name },
        select: CATEGORY_SELECT,
      });

      await this.invalidateCache();

      return this.toResponse(category);
    } catch (error) {
      this.handleWriteError(error);
    }
  }



  async update(id: bigint, dto: UpdateCategoryDto) {
    await this.assertNameAvailable(dto.name, id);

    try {
      const category = await this.prisma.category.update({
        where: { id },
        data: { name: dto.name },
        select: CATEGORY_SELECT,
      });

      await this.invalidateCache();

      return this.toResponse(category);
    } catch (error) {
      this.handleWriteError(error);
    }
  }


  async remove(id: bigint) {

    const projectsCount = await this.prisma.project.count({
      where: { categoryId: id  },
    });

    if (projectsCount > 0) {
      throw new ConflictException('Cannot delete a category that has projects');
    }

    try {
      await this.prisma.category.delete({ where: { id } });

      await this.invalidateCache();

      return { message: 'Category deleted successfully' };
    } catch (error) {
      this.handleWriteError(error);
    }
  }


  private toResponse(category: CategoryRow) {
    return { id: category.id.toString(), name: category.name };
  }

  private async assertNameAvailable(name: string, excludeId?: bigint) {
    const existing = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Category name already exists');
    }
  }

  private async invalidateCache() {
    await this.cache.del(CATEGORIES_CACHE_KEY);
  }

  private handleWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('Category name already exists');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      if (error.code === 'P2003') {
        throw new ConflictException(
          'Cannot delete a category that has projects',
        );
      }
    }
    throw error;
  }
}