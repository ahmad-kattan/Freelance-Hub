import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FreelancersService } from './freelancers.service.js';
import { avatarMulterOptions } from './avatar-upload.config.js';
import { Auth } from '../common/decorators/auth.decorator.js';
import { CurrentUser } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { UpdateProfileDto } from './dto/update-freelancer.dto.js';
import { ParseBigIntPipe } from '../common/decorators/parsebigIntpipe.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFileUpload } from '../common/decorators/api-file-upload.decorator.js';

@ApiTags('Freelancers')
@Controller('freelancers')
export class FreelancersController {
  constructor(private readonly freelancersService: FreelancersService) { }

  @Get('me')
  @Auth(UserRole.FREELANCER)
  @ApiOperation({
    summary: 'My freelancer profile',
    description: 'Freelancers only. The profile is created empty at registration.',
  })
  getMyProfile(@CurrentUser('userId') userId: string) {
    return this.freelancersService.getMyProfile(userId);
  }

  @Patch('me')
  @Auth(UserRole.FREELANCER)
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Send only the fields you want to change. hourlyRate is an integer in cents (2500 = $25.00/hour). The picture is uploaded separately.',
  })
  updateMyProfile(@CurrentUser('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.freelancersService.updateMyProfile(userId, dto);
  }

  @Put('me/avatar')
  @Auth(UserRole.FREELANCER)
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  @ApiOperation({
    summary: 'Upload or replace my profile picture',
    description:
      'multipart/form-data with the file in the field named avatar. JPEG, PNG or WEBP, up to 2 MB. The real type is checked from the file content. The previous picture is deleted. The response contains avatarUrl, a path relative to the server (for example /uploads/avatars/xxx.jpg).',
  })
  @ApiFileUpload('avatar', {
    fileDescription: 'JPEG, PNG or WEBP image, up to 2 MB',
  })
  updateAvatar(@CurrentUser('userId') userId: string,
    @UploadedFile() file?: Express.Multer.File) {
    return this.freelancersService.updateAvatar(userId, file);
  }

  @Delete('me/avatar')
  @Auth(UserRole.FREELANCER)
  deleteavatar(@CurrentUser('userId') userId:string)
  {
    return this.freelancersService.deleteAvatar(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Public freelancer profile',
    description:
      'No authentication needed. Returns name, bio, hourlyRate and avatarUrl (never the email). Banned freelancers return 404.',
  })
  getPublicProfile(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.freelancersService.getPublicProfile(id);
  }
}