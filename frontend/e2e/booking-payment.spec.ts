import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Booking-to-payment journey.
 *
 * The three journeys below drive the real form: search a workspace, pick a
 * plan and dates, review, create the booking, then initialize payment. The API
 * and the Paystack popup are mocked, so each journey can deterministically
 * observe a provider success, a provider closing the window, and a retry after
 * a failed initialization — including the requirement that retrying never
 * creates a second booking.
 */

const ACCESS_TOKEN = "e2e-access-token";

const WORKSPACE = {
  id: "ws_e2e",
  name: "E2E Hub",
  type: "COWORKING",
  hourlyRate: 150000,
  totalSeats: 12,
  active: true,
};

const USER = {
  id: "user_e2e",
  firstname: "Test",
  lastname: "Member",
  email: "member@example.com",
  role: "user",
  isActive: true,
  isSuspended: false,
  isDeleted: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
};

/** Total shown in the review step: 250,000 kobo = ₦2,500.00. */
const TOTAL_KOBO = 250_000;
const TOTAL_LABEL = "₦2,500.00";

/** Message the mocked API returns when payment initialization fails. */
const PAYMENT_OUTAGE_MESSAGE = "Payment provider unavailable";

type Journey = {
  /** Requests received by the mocked API, for duplicate-request assertions. */
  calls: {
    bookings: number;
    initialize: number;
  };
  /** How the mocked Paystack popup behaves when the user clicks "Pay". */
  setProviderBehaviour: (behaviour: "success" | "close") => Promise<void>;
  /** Makes the next `POST /payments/initialize` fail like a provider outage. */
  failNextInitialize: () => void;
  /** Bodies captured by `POST /bookings`. */
  bookingBodies: Array<Record<string, unknown>>;
};

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** The payment step's primary action, labelled with the exact total. */
function payButton(page: Page) {
  return page.getByRole("button", { name: `Pay ${TOTAL_LABEL}` });
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Signs the browser in the way the app expects (cookie for the middleware,
 * storage keys for the auth store) and installs the Paystack double.
 */
async function signIn(page: Page, baseURL: string) {
  await page.context().addCookies([
    { name: "authToken", value: ACCESS_TOKEN, url: baseURL },
  ]);

  await page.addInitScript(
    ({ token, user }) => {
      window.localStorage.setItem("authToken", token);
      window.localStorage.setItem("authUser", JSON.stringify(user));

      type PaystackOptions = {
        ref: string;
        callback: (response: { reference: string }) => void;
        onClose: () => void;
      };
      type PaystackWindow = Window & {
        PaystackPop: { setup: (options: PaystackOptions) => { openIframe: () => void } };
        __paystackBehaviour: "success" | "close";
      };

      const scoped = window as unknown as PaystackWindow;
      scoped.__paystackBehaviour = "success";

      // The popup double: opening it either reports a completed payment or
      // closes without one, mirroring the two provider outcomes.
      scoped.PaystackPop = {
        setup: (options) => ({
          openIframe: () => {
            if (scoped.__paystackBehaviour === "close") {
              options.onClose();
              return;
            }
            options.callback({ reference: options.ref });
          },
        }),
      };
    },
    { token: ACCESS_TOKEN, user: USER }
  );

  // The real inline script would overwrite the double; keep it out.
  await page.route("https://js.paystack.co/**", (route) => route.abort());
}

async function mockApi(page: Page, baseURL: string): Promise<Journey> {
  const journey: Journey = {
    calls: { bookings: 0, initialize: 0 },
    bookingBodies: [],
    setProviderBehaviour: (behaviour) =>
      page.evaluate((value) => {
        (window as unknown as { __paystackBehaviour: string }).__paystackBehaviour =
          value;
      }, behaviour),
    failNextInitialize: () => {
      failInitialize = true;
    },
  };

  let failInitialize = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (method === "GET" && pathname === `/api/workspaces/${WORKSPACE.id}`) {
      return json(route, { success: true, data: WORKSPACE });
    }

    // The workspace picker on the form reads the catalogue.
    if (method === "GET" && pathname === "/api/workspaces") {
      return json(route, {
        success: true,
        data: [WORKSPACE],
        meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
      });
    }

    if (method === "GET" && pathname === "/api/bookings/price-estimate") {
      return json(route, {
        success: true,
        data: {
          totalAmount: TOTAL_KOBO,
          planType: "DAILY",
          seatCount: 1,
          startDate: isoDaysFromNow(7),
          endDate: isoDaysFromNow(8),
        },
      });
    }

    if (method === "POST" && pathname === "/api/bookings") {
      journey.calls.bookings += 1;
      journey.bookingBodies.push(
        (request.postDataJSON() ?? {}) as Record<string, unknown>
      );
      return json(route, {
        success: true,
        data: {
          id: `booking_${journey.calls.bookings}`,
          userId: USER.id,
          workspaceId: WORKSPACE.id,
          planType: "DAILY",
          startDate: isoDaysFromNow(7),
          endDate: isoDaysFromNow(8),
          totalAmount: TOTAL_KOBO,
          status: "PENDING",
          seatCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }

    if (method === "POST" && pathname === "/api/payments/initialize") {
      journey.calls.initialize += 1;
      if (failInitialize) {
        failInitialize = false;
        // A rejected request keeps the client from reporting a provider
        // success; the message is what the payment step surfaces.
        return json(
          route,
          { statusCode: 500, message: PAYMENT_OUTAGE_MESSAGE },
          500
        );
      }
      return json(route, {
        success: true,
        data: {
          authorizationUrl: `${baseURL}/paystack-mock`,
          accessCode: "access_code_e2e",
          reference: "ref_e2e",
          paymentId: "payment_e2e",
        },
      });
    }

    if (method === "GET" && pathname === "/api/bookings") {
      return json(route, {
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });
    }

    // Notifications and anything else the shell asks for.
    return json(route, { success: true, data: [] });
  });

  return journey;
}

/** Fills step 1 (details) and moves to the review step. */
async function fillBookingDetails(page: Page) {
  // The selected workspace panel renders its (formatted) hourly rate.
  await expect(page.getByText(/\/ hr ·/)).toBeVisible();

  await page.locator("#booking-start-date").fill(isoDaysFromNow(7));
  await page.locator("#booking-end-date").fill(isoDaysFromNow(8));

  // The estimate is what the review and payment steps display.
  await expect(page.getByText(TOTAL_LABEL).first()).toBeVisible();

  await page.getByRole("button", { name: /continue to review/i }).click();
}

/** Confirms the booking (step 2) and pays (step 3). */
async function confirmBookingAndStartPayment(page: Page) {
  await page
    .getByRole("button", { name: /confirm & proceed to payment/i })
    .click();

  await expect(page.getByText(/your booking is reserved/i)).toBeVisible();
  await payButton(page).click();
}

test.describe("booking to payment journey", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
  });

  test("a workspace picked from the catalogue is the one that gets booked", async ({
    page,
    baseURL,
  }) => {
    const journey = await mockApi(page, baseURL!);

    // No `workspaceId` in the URL: the user searches the catalogue instead.
    await page.goto("/bookings/new");
    await expect(page.locator("#booking-workspace")).toBeVisible();
    await page.locator("#booking-workspace").selectOption(WORKSPACE.id);

    await fillBookingDetails(page);
    await page
      .getByRole("button", { name: /confirm & proceed to payment/i })
      .click();

    await expect(page.getByText(/your booking is reserved/i)).toBeVisible();
    expect(journey.bookingBodies).toHaveLength(1);
    expect(journey.bookingBodies[0].workspaceId).toBe(WORKSPACE.id);
  });

  test("successful payment confirms the booking and returns to the bookings list", async ({
    page,
    baseURL,
  }) => {
    const journey = await mockApi(page, baseURL!);

    await page.goto("/bookings/new?workspaceId=ws_e2e");
    await fillBookingDetails(page);
    await confirmBookingAndStartPayment(page);

    // The provider reported a completed payment, so the app hands the user off
    // to their bookings while the backend confirms the payment.
    await page.waitForURL("**/bookings");
    await expect(page.getByRole("heading", { name: "My Bookings" })).toBeVisible();

    // One booking, one payment initialization: the success path does not retry.
    expect(journey.calls.bookings).toBe(1);
    expect(journey.calls.initialize).toBe(1);
  });

  test("provider failure is reported and leaves the payment ready to retry", async ({
    page,
    baseURL,
  }) => {
    const journey = await mockApi(page, baseURL!);

    await page.goto("/bookings/new?workspaceId=ws_e2e");
    // The popup closes without a completed payment.
    await journey.setProviderBehaviour("close");
    await fillBookingDetails(page);
    await confirmBookingAndStartPayment(page);

    await expect(page.getByText(/payment window closed/i)).toBeVisible();

    // Still on the payment step, with the pay button usable again: the failure
    // is reported without claiming a payment was made.
    expect(new URL(page.url()).pathname).toBe("/bookings/new");
    await expect(payButton(page)).toBeEnabled();
    await expect(page.getByText(/payment confirmed/i)).toHaveCount(0);

    expect(journey.calls.bookings).toBe(1);
    expect(journey.calls.initialize).toBe(1);
  });

  test("retrying a failed payment does not create a duplicate booking", async ({
    page,
    baseURL,
  }) => {
    const journey = await mockApi(page, baseURL!);

    await page.goto("/bookings/new?workspaceId=ws_e2e");
    await fillBookingDetails(page);

    journey.failNextInitialize();
    await confirmBookingAndStartPayment(page);

    // The first initialization failed: the failure is surfaced and the booking
    // is not created a second time.
    await expect(page.getByText(PAYMENT_OUTAGE_MESSAGE).first()).toBeVisible();
    expect(journey.calls.bookings).toBe(1);
    expect(journey.calls.initialize).toBe(1);

    // The retry reaches the provider and completes the journey.
    await payButton(page).click();
    await page.waitForURL("**/bookings");

    expect(journey.calls.bookings).toBe(1);
    expect(journey.calls.initialize).toBe(2);
    expect(journey.bookingBodies).toHaveLength(1);
  });
});
