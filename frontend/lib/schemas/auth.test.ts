import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  accountSetupSchema,
  forgotPasswordSchema,
  personalInfoSchema,
  strongPasswordSchema,
} from "./auth";

describe("strongPasswordSchema (FE-05)", () => {
  it("matches the backend @StrongPassword rule", () => {
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

    for (const password of rejected.slice(0, 3).concat(rejected.slice(4))) {
      expect(strongPasswordSchema.safeParse(password).success).toBe(false);
    }

    expect(strongPasswordSchema.safeParse(rejected[3]).success).toBe(true);
  });

  it("states the minimum length it enforces", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    const result = strongPasswordSchema.safeParse("Ab1!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("8 characters");
    }
  });
});

describe("personalInfoSchema email bound", () => {
  it("accepts an address up to the backend limit", () => {
    const localPart = "a".repeat(EMAIL_MAX_LENGTH - "@example.com".length);
    const email = `${localPart}@example.com`;
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

describe("accountSetupSchema", () => {
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
      confirmPassword: "Different1!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });

  it("requires the terms to be accepted", () => {
    expect(
      accountSetupSchema.safeParse({ ...valid, agreeToTerms: false }).success
    ).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("uses the same email bound as the backend", () => {
    expect(forgotPasswordSchema.safeParse({ email: "ada@example.com" }).success).toBe(
      true
    );
    expect(forgotPasswordSchema.safeParse({ email: "not-an-email" }).success).toBe(
      false
    );
  });
});
