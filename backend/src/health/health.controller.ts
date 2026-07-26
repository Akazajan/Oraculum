import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Overall health check' })
  async check() {
    return this.healthService.check();
  }

  @Public()
  @Get('database')
  @ApiOperation({ summary: 'Database connectivity check' })
  async checkDatabase() {
    return this.healthService.checkDatabase();
  }

  @Public()
  @Get('payments')
  @ApiOperation({ summary: 'Payment service (Paystack) connectivity check' })
  async checkPayments() {
    return this.healthService.checkPayments();
  }

  @Public()
  @Get('storage')
  @ApiOperation({ summary: 'Storage service (Cloudinary) connectivity check' })
  async checkStorage() {
    return this.healthService.checkStorage();
  }
}
