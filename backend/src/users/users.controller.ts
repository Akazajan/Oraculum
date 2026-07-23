import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  HttpCode,
  Patch,
  Body,
  Delete,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './providers/users.service';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { UserRole } from './enums/userRoles.enum';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import { UpdateUserDto } from './dto/updateUser.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('users')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@ApiNotFoundResponse({ description: 'User not found', type: ApiErrorDto })
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private readonly usersService: UsersService) {}

  @Post(':id/profile-picture')
  @ApiOperation({ summary: 'Upload user profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async uploadProfilePicture(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @GetCurrentUser('id') currentUserId: string,
    @GetCurrentUser('role') currentUserRole: UserRole,
  ) {
    this.logger.log(`Uploading profile picture for user ${id}`);
    const result = await this.usersService.uploadUserProfilePicture(
      id,
      file,
      currentUserId,
      currentUserRole,
    );
    this.logger.log(`Profile picture updated for user ${id}`);
    return {
      message: 'Profile picture updated successfully',
      data: result,
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset a password using a reset token' })
  @ApiOkResponse({ description: 'Password reset' })
  @ApiBadRequestResponse({
    description: 'Invalid token or password',
    type: ApiErrorDto,
  })
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.usersService.resetPassword(body.token, body.newPassword);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID (public profile)' })
  @ApiOkResponse({ description: 'User retrieved' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.findOnePublicById(id);
    return {
      message: 'User retrieved successfully',
      data: user,
    };
  }
  // GET /users
  @Get()
  @ApiOperation({ summary: 'List all users' })
  async findAll() {
    const users = await this.usersService.findAllUsers();
    return { success: true, data: users };
  }

  // PATCH /users/:id
  @Patch(':id')
  @ApiOperation({ summary: 'Update a user' })
  @ApiOkResponse({ description: 'User updated' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateData: UpdateUserDto,
  ) {
    const user = await this.usersService.updateUser(id, updateData);
    return {
      success: true,
      message: `User ${id} updated successfully`,
      data: user,
    };
  }

  // DELETE /users/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.usersService.deleteUser(id);
    return;
  }
}
