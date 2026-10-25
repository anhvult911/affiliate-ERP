import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().email("Enter the operator email address."),
  password: z.string().min(6, "Password must be at least 6 characters.")
});

export type SignInInput = z.infer<typeof signInSchema>;
