import { BadRequestError } from "../../utils/httpError";

// Currencies an expense can be paid in besides rupees (a trip abroad). Kept
// to the common ones so a typo can't make a new "currency".
export const FOREIGN_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SGD",
  "THB",
  "MYR",
  "IDR",
  "LKR",
  "NPR",
  "BDT",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "SAR",
  "QAR",
  "VND",
  "KRW",
  "CNY",
  "HKD",
  "NZD",
  "ZAR",
  "TRY",
  "MVR",
] as const;

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
// A rate: rupees for one unit of the other currency, up to 6 decimals (1 IDR
// is about ₹0.0053).
const RATE_PATTERN = /^\d{1,7}(\.\d{1,6})?$/;

export interface ForeignAmount {
  originalAmount: string;
  originalCurrency: string;
  exchangeRate: string;
}

// Checks a foreign amount and works out its rupee value (two decimals). The
// rupee amount is always computed here, never taken from the client, so it
// can't disagree with the amount and rate shown next to it.
export function toRupees(input: { originalAmount?: string | null; originalCurrency?: string | null; exchangeRate?: string | null }): {
  amount: string;
  foreign: ForeignAmount;
} {
  const currency = input.originalCurrency?.trim().toUpperCase() ?? "";
  if (!(FOREIGN_CURRENCIES as readonly string[]).includes(currency)) {
    throw BadRequestError("Pick a currency from the list");
  }
  const original = input.originalAmount?.trim() ?? "";
  if (!AMOUNT_PATTERN.test(original) || Number(original) <= 0) {
    throw BadRequestError(`Enter the amount in ${currency}, above zero with at most 2 decimals`);
  }
  const rate = input.exchangeRate?.trim() ?? "";
  if (!RATE_PATTERN.test(rate) || Number(rate) <= 0) {
    throw BadRequestError(`Enter what 1 ${currency} is in rupees`);
  }
  // Integer maths: paise = original (in hundredths) × rate (in millionths).
  const originalHundredths = BigInt(Math.round(Number(original) * 100));
  const rateMillionths = BigInt(Math.round(Number(rate) * 1_000_000));
  const paise = (originalHundredths * rateMillionths + 500_000n) / 1_000_000n;
  if (paise <= 0n) {
    throw BadRequestError("That comes to less than ₹0.01");
  }
  const amount = `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;
  if (!AMOUNT_PATTERN.test(amount)) {
    throw BadRequestError("That amount is too large");
  }
  return {
    amount,
    foreign: {
      originalAmount: Number(original).toFixed(2),
      originalCurrency: currency,
      exchangeRate: String(Number(rate)),
    },
  };
}
