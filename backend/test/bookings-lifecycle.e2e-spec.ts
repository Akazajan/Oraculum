import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestDatabaseHelper } from './helpers/test-database';
import { BookingStatus, PaymentStatus } from '@prisma/client';

describe('Booking Lifecycle E2E Integration Tests (#55 BE-46)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dbHelper: TestDatabaseHelper;

  let customerUser: any;
  let workspaceOwner: any;
  let testWorkspace: any;
  let customerAuthToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    dbHelper = new TestDatabaseHelper(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dbHelper.cleanDatabase();

    // Seed deterministic test records
    workspaceOwner = await dbHelper.createTestUser({ name: 'Host Admin' });
    customerUser = await dbHelper.createTestUser({ name: 'Booking Customer' });
    testWorkspace = await dbHelper.createTestWorkspace(workspaceOwner.id);

    // Mock authentication login token generation
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: customerUser.email, password: 'hashed_password_123' });

    customerAuthToken = loginRes.body.accessToken || 'mock-jwt-token';
  });

  describe('Success Paths', () => {
    it('should complete full lifecycle: Create Reservation -> Process Payment -> Confirm Booking', async () => {
      const startTime = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
      const endTime = new Date(Date.now() + 86400000 + 7200000).toISOString(); // +2 Hours

      // Step 1: Request Booking Reservation
      const createBookingRes = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerAuthToken}`)
        .send({
          workspaceId: testWorkspace.id,
          startTime,
          endTime,
        })
        .expect(21);

      const bookingId = createBookingRes.body.id;
      expect(createBookingRes.body.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(createBookingRes.body.totalAmountCents).toBe(10000); // 2 hrs * $50

      // Step 2: Initialize Payment Intent
      const paymentIntentRes = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${customerAuthToken}`)
        .send({
          bookingId,
          paymentMethod: 'card',
        })
        .expect(201);

      expect(paymentIntentRes.body.status).toBe(PaymentStatus.REQUIRES_ACTION);
      const paymentId = paymentIntentRes.body.id;

      // Step 3: Simulate Successful Webhook/Payment Authorization
      const webhookRes = await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          event: 'payment_intent.succeeded',
          data: { paymentId, bookingId },
        })
        .expect(200);

      expect(webhookRes.body.received).toBe(true);

      // Step 4: Verify Final Booking Status in Database
      const finalBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { payment: true },
      });

      expect(finalBooking?.status).toBe(BookingStatus.CONFIRMED);
      expect(finalBooking?.payment?.status).toBe(PaymentStatus.SUCCEEDED);
    });
  });

  describe('Failure Paths & Conflict Safeguards', () => {
    it('should reject booking requests with overlapping time slots', async () => {
      const startTime = new Date(Date.now() + 86400000).toISOString();
      const endTime = new Date(Date.now() + 86400000 + 7200000).toISOString();

      // Seed an existing confirmed booking
      await prisma.booking.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: workspaceOwner.id,
          startTime,
          endTime,
          totalAmountCents: 10000,
          status: BookingStatus.CONFIRMED,
        },
      });

      // Attempt overlapping reservation
      const response = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerAuthToken}`)
        .send({
          workspaceId: testWorkspace.id,
          startTime,
          endTime,
        })
        .expect(409); // Conflict

      expect(response.body.message).toMatch(/time slot is already reserved/i);
    });

    it('should handle payment failure and transition booking to PAYMENT_FAILED', async () => {
      const startTime = new Date(Date.now() + 172800000).toISOString();
      const endTime = new Date(Date.now() + 172800000 + 3600000).toISOString();

      const booking = await prisma.booking.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: customerUser.id,
          startTime,
          endTime,
          totalAmountCents: 5000,
          status: BookingStatus.PENDING_PAYMENT,
        },
      });

      // Send Payment Failed Webhook Event
      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          event: 'payment_intent.payment_failed',
          data: { bookingId: booking.id, errorReason: 'INSUFFICIENT_FUNDS' },
        })
        .expect(200);

      const updatedBooking = await prisma.booking.findUnique({
        where: { id: booking.id },
      });

      expect(updatedBooking?.status).toBe(BookingStatus.PAYMENT_FAILED);
    });
  });
});