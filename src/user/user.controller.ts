import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { UsersService } from './user.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { CurrentUser } from '../common/decorators/index.js';
import { UpdateMeDto } from './dto/update-me.dto.js';
import { ParseBigIntPipe } from '../common/decorators/parsebigIntpipe.js';
import type { AuthUser } from '../common/type/auth-user.type.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator.js';

@ApiTags('Users')
@Auth()
@Controller('user')
export class UserController {
  constructor(private readonly userService: UsersService) { }



  
  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List users (admin only)',
    description:
      'Paginated list. Filters: search (name or email), role, isBanned. Sort by id, name, email, role or createdAt. Never returns password hashes.',
  })
  findAll(@Query() query: ListUsersQueryDto) {
    return this.userService.findAll(query);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update my name',
    description:
      'The only editable field is name. Any other field in the body is rejected with 400.',
  })
  updateMe(@CurrentUser('userId') userId: string, @Body() dto: UpdateMeDto) {
    return this.userService.updateMe(userId, dto);
  }


  @Get(':id')
   @ApiOperation({
    summary: 'Get a user by id',
    description:
      'Admins can read any user. Everyone else can only read their own account (403 otherwise).',
  })
  findOne(@Param('id', ParseBigIntPipe) id: bigint, @CurrentUser() user: AuthUser,
  ) {
    return this.userService.findOne(id, user);
  }

  @Patch(':id/ban')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Ban a user (admin only)',
    description:'The ban takes effect immediately: all sessions are revoked and old tokens stop working. Returns 409 if the user has projects in progress, 403 for admin accounts, 400 when banning yourself. Banning an already banned user is a no-op.',
  })
  ban(@Param('id', ParseBigIntPipe) id: bigint, @CurrentUser('userId') adminId: string,
  ) {
    return this.userService.ban(id, adminId);
  }

  @Patch(':id/unban')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Unban a user (admin only)',
    description: 'Lifts the ban. The user must log in again.',
  })
  unban(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.userService.unban(id);
  }
}
