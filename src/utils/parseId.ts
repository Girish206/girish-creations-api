import { BadRequestError } from "./httpError";

export function parseId(raw: string | string[] | undefined): bigint {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw BadRequestError("Invalid id");
  }
  return BigInt(raw);
}
