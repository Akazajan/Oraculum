import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '../users/enums/userRoles.enum';
import { PaymentQuery } from './providers/find-payments.provider';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { Payment } from './entities/payment.entity';

@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiNotFoundResponse({ description: 'Resource not found', type: ApiErrorDto })
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initialize')
  @ApiOperation({ summary: 'Initialize a Paystack payment for a booking' })
  @ApiOkResponse({ description: 'Payment initialized' })
  @ApiBadRequestResponse({
    description: 'Booking not payable',
    type: ApiErrorDto,
  })
  async initialize(
    @Body() dto: InitializePaymentDto,
    @GetCurrentUser('id') userId: string,
  ) {
    const data = await this.paymentsService.initialize(dto.bookingId, userId);
    return { message: 'Payment initialized', data };
  }

  /**
   * Paystack webhook — must be @Public() and receive raw body for HMAC verification.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paystack webhook endpoint (internal use only)',
    description: 'Receives Paystack events. Do not call directly.',
  })
  @ApiResponse({ status: 200, description: 'Webhook accepted' })
  @ApiBadRequestResponse({
    description: 'Invalid signature or payload',
    type: ApiErrorDto,
  })
  async webhook(@Req() req: RawBodyRequest<Request>) {
    const signature = (req.headers['x-paystack-signature'] as string) ?? '';
    const rawBody = req.rawBody ?? Buffer.from('');
    await this.paymentsService.handleWebhook(rawBody, signature);
    return { received: true };
  }

  @Post(':id/refund')
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Request a refund for a payment' })
  @ApiOkResponse({ description: 'Refund initiated' })
  @ApiBadRequestResponse({
    description: 'Payment not refundable',
    type: ApiErrorDto,
  })
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @GetCurrentUser('id') userId: string,
    @GetCurrentUser('role') userRole: UserRole,
  ) {
    const data = await this.paymentsService.refund(id, userId, userRole);
    return { message: 'Refund initiated', data };
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List payments (users see own; admins see all)' })
  @ApiBadRequestResponse({
    description: 'Invalid pagination',
    type: ApiErrorDto,
  })
  async findAll(
    @Query() query: PaymentQuery,
    @GetCurrentUser('id') userId: string,
    @GetCurrentUser('role') userRole: UserRole,
  ) {
    const result = await this.paymentsService.findAll(query, userId, userRole);
    return { message: 'Payments retrieved successfully', ...result };
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiOkResponse({ description: 'Payment retrieved', type: Payment })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetCurrentUser('id') userId: string,
    @GetCurrentUser('role') userRole: UserRole,
  ) {
    const data = await this.paymentsService.findById(id, userId, userRole);
    return { message: 'Payment retrieved successfully', data };
  }
}
