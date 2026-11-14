import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service.js';
import { DeliveryController } from './delivery.controller.js';
import { WalletModule } from '../wallet/wallet.module.js';

@Module({
  controllers: [DeliveryController],
  providers: [DeliveryService],
  imports: [WalletModule]
})
export class DeliveryModule {}
