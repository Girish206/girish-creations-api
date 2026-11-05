import { z } from "zod";

// Money is stored as a decimal string ("45.50"). Only plain positive amounts
// with at most two decimals get in, so sums and splits can't hit NaN.
const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const amountSchema = z.coerce
  .string()
  .trim()
  .refine((value) => AMOUNT_PATTERN.test(value) && Number(value) > 0, {
    message: "Enter an amount greater than zero, with at most 2 decimals",
  })
  .transform((value) => Number(value).toFixed(2));

// One person's part of a custom split. Zero is allowed here: it means they're
// not sharing this expense (e.g. the payer covering it for someone else).
export const shareAmountSchema = z.coerce
  .string()
  .trim()
  .refine((value) => AMOUNT_PATTERN.test(value), {
    message: "Enter an amount with at most 2 decimals",
  })
  .transform((value) => Number(value).toFixed(2));

export const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Enter a valid date",
});

// Sums are worked out in integer paise so they always add up exactly.
export const toCents = (value: string | number) => Math.round(Number(value) * 100);
