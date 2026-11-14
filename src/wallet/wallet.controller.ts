import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { DepositDto } from './dto/deposit.dto.js';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';
import { Auth } from '../common/decorators/auth.decorator.js';
import { CurrentUser } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) { }

  @Get('me')
  @Auth()
  @ApiOperation({
    summary: 'My wallet balance',
    description:
      'availableBalance can be spent or held. reservedBalance is money held for accepted proposals that are not yet paid out. Amounts are in cents.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          availableBalance: '10000',
          reservedBalance: '20000',
          updatedAt: '2026-11-13T10:00:00.000Z',
        },
      },
    },
  })
  getMyWallet(@CurrentUser('userId') userId: string) {
    return this.walletService.getMyWallet(userId);
  }

  @Post('deposit')
  @Auth(UserRole.CLIENT)
  @ApiOperation({
    summary: 'Top up my wallet (clients only)',
    description:
      'There is no real payment gateway in this version: the amount is simply added. amount is an integer in cents (50000 = $500.00), between 1 and 100000000.',
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        success: true,
        data: {
          availableBalance: '50000',
          reservedBalance: '0',
          transaction: {
            id: '1',
            type: 'DEPOSIT',
            amount: '50000',
            availableAfter: '50000',
            reservedAfter: '0',
            createdAt: '2026-11-13T10:00:00.000Z',
            project: null,
          },
        },
      },
    },
  })
  deposit(@CurrentUser('userId') userId: string, @Body() dto: DepositDto) {
    return this.walletService.deposit(userId, dto);
  }

  @Get('transactions')
  @Auth()
   @ApiOperation({
    summary: 'My transactions',
    description:
      'Paginated ledger of my wallet, newest first. Types: DEPOSIT, HOLD (money reserved when a proposal is accepted), RELEASE (reserved money leaves the client), EARNING (90% to the freelancer), COMMISSION (10% to the platform, visible to the admin wallet). Each row shows the balances after the transaction.',
  })
  listTransactions(@CurrentUser('userId') userId: string, @Query() query: ListTransactionsQueryDto) {
    return this.walletService.listTransactions(userId, query);
  }

}
