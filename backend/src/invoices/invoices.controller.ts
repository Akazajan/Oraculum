import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('invoices')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@ApiNotFoundResponse({ description: 'Invoice not found', type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'List invoices (users see own; admins see all)' })
  @ApiOkResponse({ description: 'Invoice list returned' })
  async findAll(
    @Query() query: InvoiceQueryDto,
    @GetCurrentUser('id') userId: string,
    @GetCurrentUser('role') userRole: UserRole,
  ) {
    const result = await this.invoicesService.findAll(query, userId, userRole);
    return { message: 'Invoices retrieved successfully', ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  @ApiOkResponse({ description: 'Invoice returned' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetCurrentUser('id') userId: string,
    @GetCurrentUser('role') userRole: UserRole,
  ) {
    const data = await this.invoicesService.findById(id, userId, userRole);
    return { message: 'Invoice retrieved successfully', data };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download invoice as PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'Invoice PDF stream returned' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @GetCurrentUser('id') userId: string,
    @GetCurrentUser('role') userRole: UserRole,
    @Res() res: Response,
  ) {
    const { pdf, invoiceNumber } = await this.invoicesService.downloadPdf(
      id,
      userId,
      userRole,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceNumber}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }
}
