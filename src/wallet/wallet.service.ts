import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { TransactionType, UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginationMeta } from '../common/utils/pagination.util.js';
import { DepositDto } from './dto/deposit.dto.js';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto.js';

export type Tx = Prisma.TransactionClient;

const COMMISSION_PERCENT = 10n;

export function splitPayment(price: bigint,penalty: bigint = 0n) {
  const net = price - penalty;
  const commission = (net * COMMISSION_PERCENT) / 100n;
  const earning = net - commission;
  return { net , commission , earning };
}

const BALANCE_SELECT = {
  availableBalance: true,
  reservedBalance: true,
} satisfies Prisma.WalletSelect;

const TRANSACTION_SELECT = {
  id: true,
  type: true,
  amount: true,
  availableAfter: true,
  reservedAfter: true,
  createdAt: true,
  project: { select: { id: true, title: true } },
} satisfies Prisma.WalletTransactionSelect;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) { }


  async getMyWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: BigInt(userId) },
      select: { ...BALANCE_SELECT, updatedAt: true },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }


  async deposit(userId: string, dto: DepositDto) {
    const amount = BigInt(dto.amount);

    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(userId) },
    })

    if (!user || user.role !== UserRole.CLIENT) {
      throw new BadRequestException('Only clients can deposit funds');
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.update({
        where: { userId: BigInt(userId) },
        data: { availableBalance: { increment: amount } },
        select: { id: true, ...BALANCE_SELECT },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEPOSIT,
          amount,
          availableAfter: wallet.availableBalance,
          reservedAfter: wallet.reservedBalance,
        },
        select: TRANSACTION_SELECT,
      });

      return {
        availableBalance: wallet.availableBalance,
        reservedBalance: wallet.reservedBalance,
        transaction,
      };
    });
  }


  async listTransactions(userId: string, query: ListTransactionsQueryDto) {
    const { page, limit, type, sortOrder } = query;

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: BigInt(userId) },
      select: { id: true },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const where: Prisma.WalletTransactionWhereInput = {
      walletId: wallet.id,
      ...(type ? { type } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({
        where,
        select: TRANSACTION_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: sortOrder }, { id: sortOrder }],
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async hold(tx: Tx, clientId: bigint, projectId: bigint, amount: bigint) {
    const updated = await tx.wallet.updateMany({
      where: { userId: clientId, availableBalance: { gte: amount } },
      data: {
        availableBalance: { decrement: amount },
        reservedBalance: { increment: amount },
      },
    });

    if (updated.count === 0) {
      throw new BadRequestException(
        'Insufficient balance. Please top up your wallet',
      );
    }

    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId: clientId },
      select: { id: true, ...BALANCE_SELECT },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.HOLD,
        amount,
        projectId,
        availableAfter: wallet.availableBalance,
        reservedAfter: wallet.reservedBalance,
      },
    });
  }

  async payout(tx: Tx, params:
     { clientId: bigint; freelancerId: bigint; projectId: bigint; price: bigint; penalty?: bigint; }) {
    const { clientId, freelancerId, projectId, price, penalty = 0n } = params;

    if (penalty < 0n || penalty > price) {
      throw new InternalServerErrorException('Invalid late penalty amount');
    }

    const { net, commission, earning } = splitPayment(price, penalty);

    const [clientWallet, freelancerWallet, platformWallet] = await Promise.all([
      tx.wallet.findUniqueOrThrow({
        where: { userId: clientId },
        select: { id: true },
      }),
      tx.wallet.findUniqueOrThrow({
        where: { userId: freelancerId },
        select: { id: true },
      }),
      tx.wallet.findFirst({
        where: { user: { role: UserRole.ADMIN } },
        select: { id: true },
      }),
    ]);

    if (!platformWallet) {
      throw new InternalServerErrorException(
        'Platform wallet is not configured. Run the seed',
      );
    }

    type Op = { walletId: bigint; type: TransactionType; amount: bigint; guard?: Prisma.WalletWhereInput; data: Prisma.WalletUpdateManyMutationInput };

    const ops: Op[] = [
      {
        walletId: clientWallet.id,
        type: TransactionType.RELEASE,
        amount: price,
        guard: { reservedBalance: { gte: price } },
        data: { reservedBalance: { decrement: price } },
      },
      {
        walletId: clientWallet.id,
        type: TransactionType.PENALTY_REFUND,
        amount: penalty,
        data: { availableBalance: { increment: penalty } },
      },
      {
        walletId: freelancerWallet.id,
        type: TransactionType.EARNING,
        amount: earning,
        data: { availableBalance: { increment: earning } },
      },
      {
        walletId: platformWallet.id,
        type: TransactionType.COMMISSION,
        amount: commission,
        data: { availableBalance: { increment: commission } },
      },
    ].filter((op) => op.amount > 0n)
      .sort((a, b) =>a.walletId < b.walletId ? -1 : a.walletId > b.walletId ? 1 : 0);

    for (const op of ops) {
      const updated = await tx.wallet.updateMany({
        where: { id: op.walletId, ...op.guard },
        data: op.data,
      });

      if (updated.count !== 1) {
        throw new ConflictException('Reserved funds are missing for this project');
      }

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: op.walletId },
        select: BALANCE_SELECT,
      });

      await tx.walletTransaction.create({
        data: {
          walletId: op.walletId,
          type: op.type,
          amount: op.amount,
          projectId,
          availableAfter: wallet.availableBalance,
          reservedAfter: wallet.reservedBalance,
        },
      });
    }

    return { price, penalty, net, commission, earning };
  }
}