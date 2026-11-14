import { Module } from '@nestjs/common';
import { ProposalsService } from './proposals.service.js';
import { ProposalsController } from './proposals.controller.js';
import { WalletModule } from '../wallet/wallet.module.js';

@Module({
  controllers: [ProposalsController],
  providers: [ProposalsService],
  imports:[WalletModule]
})
export class ProposalsModule {}
