import { z } from "zod";

/**
 * Constraints mirrored from the backend auth DTOs
 * (`backend/src/auth/dto/create-user.dto.ts`) so the client rejects exactly what
 * the API rejects instead of letting a request fail server-side:
 * `@MaxLength(254)` on email, `@MaxLength(30)` on names, `@StrongPassword` on
 * passwords (at least one lowercase, uppercase, number and special character).
 */
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 30;
export const PASSWORD_MIN_LENGTH = 8;

/** Human-readable version of {@link strongPasswordSchema}, for field help text. */
export const PASSWORD_REQUIREMENTS =
  `At least ${PASSWORD_MIN_LENGTH} characters, including an uppercase letter, ` +
  "a lowercase letter, a number and a special character.";

/** Same rule as the backend's `@StrongPassword` decorator. */
export const strongPasswordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  )
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

// Personal Info Schema
export const personalInfoSchema = z.object({
  fullName: z
    .string()
    .min(1, "Full name is required")
    .min(2, "Full name must be at least 2 characters")
    .max(100, "Full name must be less than 100 characters"),

  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(EMAIL_MAX_LENGTH, `Email must be at most ${EMAIL_MAX_LENGTH} characters`),

  phoneNumber: z
    .string()
    .min(1, "Phone number is required")
    .regex(/^[\+]?[1-9][\d]{0,15}$/, "Please enter a valid phone number"),

  location: z
    .string()
    .max(100, "Location must be less than 100 characters")
    .optional(),
});

// Account Setup Schema
export const accountSetupSchema = z
  .object({
    userType: z.enum(["member", "staff", "visitor"], {
      message: "Please select a user type",
    }),

    organizationName: z
      .string()
      .min(1, "Organization name is required")
      .min(2, "Organization name must be at least 2 characters")
      .max(100, "Organization name must be less than 100 characters"),

    password: strongPasswordSchema,

    confirmPassword: z.string().min(1, "Please confirm your password"),

    agreeToTerms: z.boolean().refine((val) => val === true, {
      message: "You must agree to the terms and conditions",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// Complete Registration Schema
export const registrationSchema = personalInfoSchema.merge(accountSetupSchema);

// Type exports
export type PersonalInfoForm = z.infer<typeof personalInfoSchema>;
export type AccountSetupForm = z.infer<typeof accountSetupSchema>;
export type RegistrationForm = z.infer<typeof registrationSchema>;

// Forgot Password Schema
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(EMAIL_MAX_LENGTH, `Email must be at most ${EMAIL_MAX_LENGTH} characters`),
});

export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
