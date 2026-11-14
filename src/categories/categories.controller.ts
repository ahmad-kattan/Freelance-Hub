import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { Auth } from '../common/decorators/auth.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ParseBigIntPipe } from '../common/decorators/parsebigIntpipe.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) { }

  @Get()
  @ApiOperation({
    summary: 'List all categories (public)',
    description:
      'No authentication needed. The full list is returned without pagination (it is small) and is cached; any admin change refreshes it immediately.',
  })
  findAll() {
    return this.categoriesService.findAll();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a category (admin only)',
    description: 'Names are unique, ignoring letter case (409 if taken).',
  })
  @Auth(UserRole.ADMIN)
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Rename a category (admin only)',
    description: '404 if not found, 409 if the new name is already used.',
  })
  update(@Param('id', ParseBigIntPipe) id: bigint, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @Auth(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Delete a category (admin only)',
    description:
      '409 if any project (including deleted ones) still uses this category.',
  })
  remove(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.categoriesService.remove(id);
  }
}