import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {

    constructor(
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
    ) {
        const secret = configService.get<string>('JWT_SECRET');

        if (!secret) {
            throw new Error('JWT_SECRET is missing from .env');
        }

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: secret,
        });
    }

    async validate(payload: any) {

        // 1. Reject refresh tokens
        if (payload.type !== 'access') {
            throw new UnauthorizedException('Invalid access token');
        }

        // 2. Check user
        const user = await this.prisma.user.findUnique({
            where: {
                id: BigInt(payload.sub),
            },
            select: {
                id: true,
                email: true,
                role: true,
                isBanned: true,
            },
        });

        if (!user || user.isBanned) {
            throw new UnauthorizedException('User not found or banned');
        }

        // 3. Check session
        const session = await this.prisma.session.findFirst({
            where: {
                id: BigInt(payload.sid),
                userId: user.id,
                revokedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
        });

        if (!session) {
            throw new UnauthorizedException('Session is invalid or expired');
        }

        // 4. Return authenticated user
        return {
            userId: user.id.toString(),
            sid: session.id.toString(),
            email: user.email,
            role: user.role,
            type: payload.type,
        };
    }
}