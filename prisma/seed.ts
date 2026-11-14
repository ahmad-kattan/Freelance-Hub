
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.js';
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
 
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
 

const BCRYPT_ROUNDS = 10;
 
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
 
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL or ADMIN_PASSWORD is missing');
  }
 
  if (password.length < 6) {
    throw new Error('ADMIN_PASSWORD must be at least 6 characters');
  }
 
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
 
    const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      name: 'Platform Admin',
      role: UserRole.ADMIN,
      wallet: { create: {} },
    },
    update: {
      role: UserRole.ADMIN,
      wallet: { upsert: { create: {}, update: {} } },
    },
    select: {
      id: true,
      email: true,
      role: true,
      isBanned: true,
      wallet: {
        select: {
          id: true,
          availableBalance: true,
          reservedBalance: true,
        },
      },
    },
  });
 
  const otherAdmins = await prisma.user.count({
    where: { role: UserRole.ADMIN, id: { not: admin.id } },
  });
 
  if (otherAdmins > 0) {
    console.warn(
      `WARNING: found ${otherAdmins} other ADMIN account(s). ` +
        'The platform must have exactly one admin (one platform wallet).',
    );
  }
 
  if (admin.isBanned) {
    console.warn('WARNING: the admin account is banned.');
  }
 
  console.log('Admin account ready:', {
    id: admin.id.toString(),
    email: admin.email,
    role: admin.role,
    platformWalletId: admin.wallet?.id.toString(),
    available: admin.wallet?.availableBalance.toString(),
    reserved: admin.wallet?.reservedBalance.toString(),
  });
}
 
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });