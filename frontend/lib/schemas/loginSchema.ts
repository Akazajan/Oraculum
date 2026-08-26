import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: "Email is required" })
    .and(z.email({ error: "Invalid email address" })),
  password: z
    .string()
    .min(1, { error: "Password is required" }),
});

export type LoginSchema = z.infer<typeof loginSchema>;
