import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeliveryService } from './delivery.service.js';

@Injectable()
export class DeliveryScheduler {
  private readonly logger = new Logger(DeliveryScheduler.name);

  private running = false;

  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly config: ConfigService,
  ) { }

  @Cron(CronExpression.EVERY_HOUR)
 
  async autoApproveOverdueDeliveries() {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      const days = this.config.get<number>('AUTO_APPROVE_DAYS',2);
      const approved = await this.deliveryService.autoApproveOverdue(days);

      if (approved > 0) {
        this.logger.log(`Auto-approved ${approved} overdue delivery(ies)`);
      }
    }
    catch (error) {
      this.logger.error(
        'Auto-approve job failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
    finally {
      this.running = false;
    }
  }
}