import {
    ConflictException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';

import { LoginDto } from './dto/LoginDto.js';
import { UserRole } from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';

type TokenPayload = {
    sub: string;
    sid: string;
    type: 'access' | 'refresh';
    email?: string;
    role?: UserRole;
    jti?: string;
};

type SessionMetadata = {
    deviceType?: string;
    ipAddress?: string;
};

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) { }


    async register(dto: RegisterDto) {
        const email = dto.email.trim().toLowerCase();

        const existingUser = await this.prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new ConflictException('Email already exists');
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);

        try {
            const user = await this.prisma.user.create({
                data: {
                    name: dto.name.trim(),
                    email,
                    passwordHash,
                    role: dto.role,
                    wallet: { create: {} },
                    ...(dto.role === UserRole.FREELANCER && {
                        freelancerProfile: { create: {} },
                    }),
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    createdAt: true,
                },
            });

            return {
                message: 'Account created successfully',
                user: {
                    ...user,
                    id: user.id.toString(),
                },
            };
        } catch (e) {
            if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === 'P2002'
            ) {
                throw new ConflictException('Email already exists');
            }
            throw e;
        }
    }

    async login(dto: LoginDto, metadata: SessionMetadata = {}) {
        const email = dto.email.trim().toLowerCase();

        const user = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid email or password');
        }

        const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

        if (!passwordMatches) {
            throw new UnauthorizedException('Invalid email or password');
        }

        if (user.isBanned) {
            throw new ForbiddenException('Your account has been banned');
        }

        const now = new Date();

        const sessionExpiresAt = new Date(
            now.getTime() + 7 * 24 * 60 * 60 * 1000,
        );

        const result = await this.prisma.$transaction(async (tx) => {
            const session = await tx.session.create({
                data: {
                    userId: user.id,
                    deviceType: metadata.deviceType,
                    ipAddress: metadata.ipAddress,
                    expiresAt: sessionExpiresAt,
                },
            });

            const tokens = await this.generateTokens(user, session.id);

            await tx.refreshToken.create({
                data: {
                    sessionId: session.id,
                    tokenHash: this.hashToken(tokens.refresh_token),
                    expiresAt: sessionExpiresAt,
                },
            });

            return {
                tokens,
                sessionId: session.id,
            };
        });

        return {
            access_token: result.tokens.access_token,
            refresh_token: result.tokens.refresh_token,
            user: {
                id: user.id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
            },
            session_id: result.sessionId.toString(),
        };
    }


    async refreshToken(refreshToken: string) {
        const secret = this.getJwtSecret();

        let payload: TokenPayload;

        try {
            payload = await this.jwtService.verifyAsync<TokenPayload>(
                refreshToken, { secret });
        }
        catch {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        if (payload.type !== 'refresh' || !payload.sub || !payload.sid) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        const tokenHash = this.hashToken(refreshToken);

        const storedToken = await this.prisma.refreshToken.findUnique({
            where: {
                tokenHash,
            },
            include: {
                session: {
                    include: {
                        user: true,
                    },
                },
            },
        });

        if (!storedToken) {
            throw new UnauthorizedException('Refresh token not found');
        }

        const now = new Date();
        const session = storedToken.session;
        const user = session.user;

        if (session.id.toString() !== payload.sid || user.id.toString() !== payload.sub) {
            throw new UnauthorizedException('Invalid refresh token');
        }


        if (storedToken.usedAt !== null) {
            await this.prisma.session.updateMany({
                where: {
                    userId: user.id,
                    revokedAt: null,
                },
                data: {
                    revokedAt: now,
                },
            });

            throw new UnauthorizedException(
                'Refresh token reuse detected. All sessions have been revoked',
            );
        }

        if (session.revokedAt !== null || session.expiresAt <= now || storedToken.expiresAt <= now) {
            throw new UnauthorizedException('Session expired or revoked');
        }

        if (user.isBanned) {
            await this.prisma.session.updateMany({
                where: {
                    userId: user.id,
                    revokedAt: null,
                },
                data: {
                    revokedAt: now,
                },
            });

            throw new ForbiddenException('Your account has been banned');
        }

        const newSessionExpiresAt = new Date(
            now.getTime() + 7 * 24 * 60 * 60 * 1000,
        );

        const newTokens = await this.generateTokens(user, session.id);

        const transactionResult = await this.prisma.$transaction(
            async (tx) => {
                const updateResult = await tx.refreshToken.updateMany({
                    where: {
                        id: storedToken.id,
                        usedAt: null,
                    },
                    data: {
                        usedAt: now,
                    },
                });

                if (updateResult.count !== 1) {
                    await tx.session.updateMany({
                        where: {
                            userId: user.id,
                            revokedAt: null,
                        },
                        data: {
                            revokedAt: now,
                        },
                    });

                    return {
                        reuseDetected: true,
                    };
                }

                await tx.session.update({
                    where: {
                        id: session.id,
                    },
                    data: {
                        expiresAt: newSessionExpiresAt,
                    },
                });

                await tx.refreshToken.create({
                    data: {
                        sessionId: session.id,
                        tokenHash: this.hashToken(newTokens.refresh_token),
                        expiresAt: newSessionExpiresAt,
                    },
                });

                return {
                    reuseDetected: false,
                };
            },
        );

        if (transactionResult.reuseDetected) {
            throw new UnauthorizedException(
                'Refresh token reuse detected. All sessions have been revoked',
            );
        }

        return {
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token,
        };
    }

    async revokeSession(userId: bigint | string, sessionId: bigint | string) {
        const result = await this.prisma.session.updateMany({
            where: {
                id: BigInt(sessionId),
                userId: BigInt(userId),
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        if (result.count === 0) {
            throw new NotFoundException('Active session not found');
        }

        return { message: 'Session logged out successfully' };
    }

    async logoutOthers(userId: bigint | string, currentSessionId: bigint | string) {
        const result = await this.prisma.session.updateMany({
            where: {
                userId: BigInt(userId),
                id: {
                    not: BigInt(currentSessionId),
                },
                revokedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
            data: {
                revokedAt: new Date(),
            },
        });

        return {
            message: 'Other sessions have been logged out',
            revokedSessions: result.count,
        };
    }


    async getMyProfile(userId: bigint | string) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: BigInt(userId),
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isBanned: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return {
            ...user,
            id: user.id.toString(),
        };
    }

    async listSessions(userId: bigint | string, currentSessionId: bigint | string) {
        const sessions = await this.prisma.session.findMany({
            where: {
                userId: BigInt(userId),
                revokedAt: null,
                expiresAt: { gt: new Date() },
            },
            orderBy: { loginTime: 'desc' },
            select: { id: true, deviceType: true, ipAddress: true, loginTime: true },
        });

        return sessions.map((s) => ({
            ...s,
            id: s.id.toString(),
            isCurrent: s.id === BigInt(currentSessionId),
        }));
    }

    async logoutAll(userId: bigint | string) {
        const result = await this.prisma.session.updateMany({
            where: { userId: BigInt(userId), revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return { message: 'Logged out from all devices', revokedSessions: result.count };
    }


    private async generateTokens(user: { id: bigint; email: string; role: UserRole }, sessionId: bigint) {
        const secret = this.getJwtSecret();

        const accessPayload: TokenPayload = {
            sub: user.id.toString(),
            sid: sessionId.toString(),
            email: user.email,
            role: user.role,
            type: 'access',
        };

        const refreshPayload: TokenPayload = {
            sub: user.id.toString(),
            sid: sessionId.toString(),
            type: 'refresh',
            jti: randomUUID(),
        };

        const [access_token, refresh_token] = await Promise.all([
            this.jwtService.signAsync(accessPayload, { secret, expiresIn: '15m' }),

            this.jwtService.signAsync(refreshPayload, { secret, expiresIn: '7d' }),
        ]);

        return {
            access_token,
            refresh_token,
        };
    }


    private hashToken(token: string): string {
        return createHash('sha256')
            .update(token)
            .digest('hex');
    }


    private getJwtSecret(): string {
        const secret = this.configService.get<string>('JWT_SECRET');

        if (!secret) {
            throw new InternalServerErrorException(
                'JWT_SECRET is not configured',
            );
        }

        return secret;
    }
}
