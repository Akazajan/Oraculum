import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { JwtAuthGuard } from './guard/jwt.auth.guard';
import { RolesGuard } from './guard/roles.guard';
import { Roles } from './decorators/roles.decorators';
import { UserRole } from '../users/enums/userRoles.enum';
import { User } from '../users/entities/user.entity';
import { CurrentUser } from './decorators/current.user.decorators';
import { GetCurrentUser } from './decorators/getCurrentUser.decorator';
import { Public } from './decorators/public.decorator';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { SendPasswordResetOtpDto } from './dto/send-password-reset-otp.dto';
import { Setup2faDto } from './dto/setup-2fa.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { UseBackupCodeDto } from './dto/use-backup-code.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('auth')
@ApiBearerAuth('bearer')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user (sends OTP)' })
  @ApiResponse({ status: 201, description: 'User created and OTP sent' })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  create(@Body() createUserDto: CreateUserDto) {
    return this.authService.createUser(createUserDto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the OTP delivered after registration' })
  @ApiResponse({ status: 200, description: 'OTP verified, user activated' })
  @ApiResponse({ status: 401, type: ApiErrorDto })
  verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Public()
  @Post('resend-verification-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the registration verification OTP' })
  @ApiResponse({ status: 200, description: 'OTP re-delivered' })
  @ApiResponse({ status: 429, type: ApiErrorDto })
  resendVerificationOtp(@Body() resendOtpDto: ResendOtpDto) {
    return this.authService.resendVerificationOtp(resendOtpDto.email);
  }

  @Post('register-admin')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Admin-only: register an admin or staff user' })
  createAdmin(@Body() createUserDto: CreateUserDto) {
    return this.authService.createAdminUser(createUserDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and obtain JWT access + refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens returned' })
  @ApiResponse({ status: 401, type: ApiErrorDto })
  login(@Body() loginUserDto: LoginUserDto) {
    return this.authService.login(loginUserDto);
  }

  @Public()
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for new tokens' })
  @ApiResponse({ status: 200, description: 'Tokens refreshed' })
  @ApiResponse({ status: 401, type: ApiErrorDto })
  refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('current-user')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, description: 'User profile returned' })
  @ApiResponse({ status: 401, type: ApiErrorDto })
  retrieveCurrentUser(@CurrentUser() user: User) {
    return user;
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password-reset OTP (aliased below)' })
  forgotPassword(@Body() sendPasswordResetOtpDto: SendPasswordResetOtpDto) {
    return this.authService.requestResetPasswordOtp(sendPasswordResetOtpDto);
  }

  @Public()
  @Post('send-reset-password-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password-reset OTP' })
  requestResetPasswordOtp(
    @Body() sendPasswordResetOtpDto: SendPasswordResetOtpDto,
  ) {
    return this.authService.requestResetPasswordOtp(sendPasswordResetOtpDto);
  }

  @Public()
  @Post('resend-reset-password-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend a password-reset OTP' })
  resendResetPasswordVerificationOtp(@Body() resendOtpDto: ResendOtpDto) {
    return this.authService.resendResetPasswordVerificationOtp(resendOtpDto);
  }

  @Public()
  @Post('verify-reset-password-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a password-reset OTP' })
  verifyResetPasswordOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyResetPasswordOtp(verifyOtpDto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset the password using a verified OTP' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Start enrolling a TOTP authenticator' })
  setup2fa(@GetCurrentUser('id') userId: string) {
    return this.authService.setup2fa(userId);
  }

  @Post('2fa/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Confirm TOTP enrollment with a 6-digit code' })
  confirm2fa(@GetCurrentUser('id') userId: string, @Body() dto: Setup2faDto) {
    return this.authService.confirm2fa(userId, dto);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a TOTP code during the login flow' })
  verifyTotpLogin(@Body() dto: VerifyTotpDto) {
    return this.authService.verifyTotpLogin(dto);
  }

  @Public()
  @Post('2fa/backup-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume a 2FA backup code' })
  verifyBackupCode(@Body() dto: UseBackupCodeDto) {
    return this.authService.verifyBackupCode(dto);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disable 2FA for the current user' })
  disable2fa(@GetCurrentUser('id') userId: string, @Body() dto: Disable2faDto) {
    return this.authService.disable2fa(userId, dto);
  }

  @Get('2fa/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the 2FA status for the current user' })
  get2faStatus(@GetCurrentUser('id') userId: string) {
    return this.authService.get2faStatus(userId);
  }
}
