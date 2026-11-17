import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service.js';
import { DeliveryController } from './delivery.controller.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { DeliveryScheduler } from './delivery.scheduler.js';

@Module({
  controllers: [DeliveryController],
  providers: [DeliveryService,DeliveryScheduler],
  imports: [WalletModule]
})
export class DeliveryModule {}
