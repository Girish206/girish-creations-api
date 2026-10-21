import { z } from "zod";

// Mobile numbers are stored as digits only, with an Indian number's "+91" /
// "91" / leading "0" dropped, so "98765 43210", "+91 98765-43210" and
// "09876543210" are all the same number (for uniqueness and for login).
// Returns null when what's left isn't 10–15 digits.
export function normalizeMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export const mobileSchema = z.string().transform((raw, ctx) => {
  const mobile = normalizeMobile(raw);
  if (!mobile) {
    ctx.addIssue({ code: "custom", message: "Enter a valid mobile number (10 digits)" });
    return z.NEVER;
  }
  return mobile;
});
