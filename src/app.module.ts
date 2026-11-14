import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { PrismaModule } from './prisma/prisma.module.js';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UserModule } from './user/user.module.js';
import { FreelancersModule } from './freelancers/freelancers.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { WalletModule } from './wallet/wallet.module.js';
import { ProposalsModule } from './proposals/proposals.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import Joi from 'joi';
import { FilesModule } from './common/files/files.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().required(),
        ADMIN_EMAIL: Joi.string().required(),
        ADMIN_PASSWORD: Joi.string().required()
      })
    },
    ),
    CacheModule.register({ isGlobal: true, ttl: 10_000 }),
    PrismaModule,
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    UserModule,
    FreelancersModule,
    CategoriesModule,
    ProjectsModule,
    WalletModule,
    ProposalsModule,
    DeliveryModule,
    FilesModule
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
}
)

export class AppModule { }
