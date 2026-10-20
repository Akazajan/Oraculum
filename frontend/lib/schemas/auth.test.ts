import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  accountSetupSchema,
  forgotPasswordSchema,
  personalInfoSchema,
  strongPasswordSchema,
} from "./auth";

// Tests for the strong-password rule. It is meant to mirror the backend's
// @StrongPassword validator, so the client and server accept the same passwords
describe("strongPasswordSchema (FE-05)", () => {
  it("matches the backend @StrongPassword rule", () => {
    // Has uppercase, lowercase, a number, a special character, and 8+ characters
    expect(strongPasswordSchema.safeParse("Sup3r$ecret!").success).toBe(true);
  });

  it("rejects each missing character class", () => {
    const rejected = [
      "Ab1!aaa", // too short
      "sup3r$ecret!", // no uppercase
      "SUP3R$ECRET!", // no lowercase
      "Sup3r$ecret!", // has a number, so this one is valid — see below
      "SuperSecret!", // no number
      "Sup3rSecret", // no special character
    ];

    // Check every entry except index 3 (the valid one): slice(0, 3) takes the
    // first three, and slice(4) takes the rest. Each of these must fail validation
    for (const password of rejected.slice(0, 3).concat(rejected.slice(4))) {
      expect(strongPasswordSchema.safeParse(password).success).toBe(false);
    }

    // The entry at index 3 is actually a valid password, so it is asserted
    // separately as a success
    expect(strongPasswordSchema.safeParse(rejected[3]).success).toBe(true);
  });

  it("states the minimum length it enforces", () => {
    // The exported constant should match the backend's minimum
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    // A too-short password should fail...
    const result = strongPasswordSchema.safeParse("Ab1!");
    expect(result.success).toBe(false);
    if (!result.success) {
      // ...and the first error message should tell the user the minimum length
      expect(result.error.issues[0]?.message).toContain("8 characters");
    }
  });
});

// Tests for the email length limit inside the personal info form schema
describe("personalInfoSchema email bound", () => {
  it("accepts an address up to the backend limit", () => {
    // Pad the local part so the whole address is exactly EMAIL_MAX_LENGTH
    // characters long (the boundary case)
    const localPart = "a".repeat(EMAIL_MAX_LENGTH - "@example.com".length);
    const email = `${localPart}@example.com`;
    // Sanity check that the test data really sits on the boundary
    expect(email.length).toBe(EMAIL_MAX_LENGTH);

    expect(
      personalInfoSchema.safeParse({
        fullName: "Ada Lovelace",
        email,
        phoneNumber: "+2348000000000",
      }).success
    ).toBe(true);
  });

  it("rejects an address longer than the backend allows", () => {
    // The local part alone is EMAIL_MAX_LENGTH long, so the full address
    // is well over the limit
    const email = `${"a".repeat(EMAIL_MAX_LENGTH)}@example.com`;

    expect(
      personalInfoSchema.safeParse({
        fullName: "Ada Lovelace",
        email,
        phoneNumber: "+2348000000000",
      }).success
    ).toBe(false);
  });
});

// Tests for the account setup step (user type, organization, password, terms)
describe("accountSetupSchema", () => {
  // A known-good payload reused by the tests below; each test overrides
  // only the field it cares about. `as const` keeps "member" as a literal type
  const valid = {
    userType: "member" as const,
    organizationName: "Oraculum",
    password: "Sup3r$ecret!",
    confirmPassword: "Sup3r$ecret!",
    agreeToTerms: true,
  };

  it("accepts a complete setup", () => {
    expect(accountSetupSchema.safeParse(valid).success).toBe(true);
  });

  it("reports a password mismatch on the confirmation field", () => {
    const result = accountSetupSchema.safeParse({
      ...valid,
      // A strong password, but different from `password`
      confirmPassword: "Different1!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // The error should be attached to confirmPassword so the form can show
      // it under that input rather than as a general error
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });

  it("requires the terms to be accepted", () => {
    expect(
      accountSetupSchema.safeParse({ ...valid, agreeToTerms: false }).success
    ).toBe(false);
  });
});

// Tests for the forgot-password form
describe("forgotPasswordSchema", () => {
  it("uses the same email bound as the backend", () => {
    // A normal, valid email passes
    expect(forgotPasswordSchema.safeParse({ email: "ada@example.com" }).success).toBe(
      true
    );
    // A malformed email fails
    expect(forgotPasswordSchema.safeParse({ email: "not-an-email" }).success).toBe(
      false
    );
  });
});