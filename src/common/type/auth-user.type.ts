import { UserRole } from '../../generated/prisma/enums.js';

export type AuthUser = {
  userId: string;
  sid: string;
  email: string;
  role: UserRole;
};