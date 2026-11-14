import {
    Body,
    Controller,
    Get,
    Post,
    Delete,
    Param,
    UseGuards,
    HttpCode,
    Req,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { LoginDto } from './dto/LoginDto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/index.js';
import { ParseBigIntPipe } from '../common/decorators/parsebigIntpipe.js';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { LoginThrottlerGuard } from '../common/guards/login-throttler.guard.js';
import { Auth } from '../common/decorators/auth.decorator.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {

    constructor(private readonly authService: AuthService) { }


    @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
    @Post('register')
    @ApiOperation({ summary: 'Create an account', description: 'role must be CLIENT or FREELANCER (admin accounts cannot be created here). The email must be unique (409). Limited to 3 per hour per IP.' })
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @UseGuards(LoginThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @Post('login')
    @HttpCode(200)
    @ApiOperation({ summary: 'Log in', description: 'Returns access_token (15 minutes) and refresh_token (7 days) for this device. 5 attempts per minute. A banned account gets 403.' }) 
    login(@Body() dto: LoginDto, @Req() req: Request) {
        return this.authService.login(dto, {
            deviceType: req.headers['user-agent']?.slice(0, 100),
            ipAddress: req.ip,
        });
    }

    @Post('refresh')
    @HttpCode(200)
    @ApiOperation({ summary: 'Renew tokens', description: 'Send the refresh_token in the body to get a new pair. Each refresh token works once; reusing an old one revokes every session of the user (401).' })
    refresh(@Body() dto: RefreshTokenDto) {
        return this.authService.refreshToken(dto.refresh_token);
    }

    @Auth()
    @Get('profile')

    getProfile(@CurrentUser('userId') userId: string) {
        return this.authService.getMyProfile(userId);
    }

    @Auth()
    @Post('logout')
    @ApiOperation({ summary: 'Log out this device' })
    logout(
        @CurrentUser('userId') userId: string,
        @CurrentUser('sid') sid: string,
    ) {
        return this.authService.revokeSession(userId, sid);
    }

    @Auth()
    @Post('logout-others')
    @ApiOperation({ summary: 'Log out all other devices' })  
    logoutOthers(
        @CurrentUser('userId') userId: string,
        @CurrentUser('sid') sid: string,
    ) {
        return this.authService.logoutOthers(userId, sid);
    }

    @Auth()
    @Get('sessions')
    @ApiOperation({ summary: 'List my active devices', description: 'Device type, IP and login time. isCurrent marks the device making this request.' })
    listSessions(
        @CurrentUser('userId') userId: string,
        @CurrentUser('sid') sid: string,
    ) {
        return this.authService.listSessions(userId, sid);
    }

    @Auth()
    @Delete('sessions/:sessionId')
    @ApiOperation({ summary: 'Log out one device by session id' })
    logoutSession(
        @CurrentUser('userId') userId: string,
        @Param('sessionId', ParseBigIntPipe) sessionId: bigint,
    ) {
        return this.authService.revokeSession(userId, sessionId);
    }

    @Auth()
    @Post('logout-all')
    @ApiOperation({ summary: 'Log out all devices' })
    logoutAll(@CurrentUser('userId') userId: string) {
        return this.authService.logoutAll(userId);
    }
}