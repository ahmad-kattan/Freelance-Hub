import { Module } from '@nestjs/common';
import { FreelancersService } from './freelancers.service.js';
import { FreelancersController } from './freelancers.controller.js';

@Module({
  controllers: [FreelancersController],
  providers: [FreelancersService],
})
export class FreelancersModule {}
