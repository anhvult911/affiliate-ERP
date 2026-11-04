import { z } from "zod";

/**
 * Login identifier → Supabase email.
 *
 * Supabase Auth only signs in with an email address, but a solo operator should not have
 * to type a domain every time. A bare username (`admin`) is therefore mapped to
 * `<username>@<AUTH_EMAIL_DOMAIN>`; anything containing `@` is used as-is, so real email
 * addresses keep working.
 */

export const DEFAULT_AUTH_EMAIL_DOMAIN = "erp.local";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function resolveLoginEmail(
  identifier: string,
  domain: string = process.env.AUTH_EMAIL_DOMAIN?.trim() || DEFAULT_AUTH_EMAIL_DOMAIN
): string {
  const value = identifier.trim().toLowerCase();
  if (!value) return "";

  if (value.includes("@")) return value;

  const suffix = domain.trim().replace(/^@+/, "").toLowerCase() || DEFAULT_AUTH_EMAIL_DOMAIN;
  return `${value}@${suffix}`;
}

export const signInSchema = z.object({
  /**
   * Accepts `admin` or `admin@erp.local`. The transformation happens before validation so
   * a username is a first-class input, not a special case in the action.
   */
  email: z
    .string()
    .trim()
    .min(1, "Nhập tài khoản Operator.")
    .transform((value) => resolveLoginEmail(value))
    .refine((value) => EMAIL.test(value), "Tài khoản không hợp lệ — dùng tên đăng nhập hoặc email."),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự.")
});

export type SignInInput = z.infer<typeof signInSchema>;
