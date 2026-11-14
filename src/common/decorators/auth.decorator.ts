import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { Roles } from './roles.decorator.js';
import { UserRole } from '../../generated/prisma/enums.js';
import { ApiBearerAuth } from '@nestjs/swagger';
 
/**
 * @Auth()                      ← أي مستخدم مسجَّل دخوله
 * @Auth(UserRole.FREELANCER)   ← مستقل فقط
 * @Auth(UserRole.ADMIN)        ← مدير فقط
 */
export const Auth = (...roles: UserRole[]) =>
  applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles(...roles),
  ApiBearerAuth()
);