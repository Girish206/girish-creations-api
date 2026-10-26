import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { BadRequestError } from "../../utils/httpError";

// A player's QR code (My Profile → My QR code) carries a signed token, not
// just their id: adding someone to a team by QR proves they showed you their
// phone, as reading out their number would. Tokens last a short while so a
// forwarded screenshot soon stops working; the app refreshes the code while
// it's on screen. Nothing is stored — the signature is the proof.

export const PLAYER_QR_TTL_MS = 15 * 60_000;

// Its own key, derived from the session secret, so a QR signature can never
// pass for anything else.
const key = createHmac("sha256", env.jwtSecret).update("cricket-player-qr").digest();

const sign = (playerId: bigint, expires: number) =>
  createHmac("sha256", key).update(`${playerId}.${expires}`).digest("base64url").slice(0, 22);

// "<id>.<expiry, base 36>.<signature>"
export function playerQrToken(playerId: bigint) {
  const expires = Date.now() + PLAYER_QR_TTL_MS;
  return { token: `${playerId}.${expires.toString(36)}.${sign(playerId, expires)}`, expiresAt: new Date(expires) };
}

// The player a scanned token is for, if it's genuine and still fresh.
export function playerFromQr(token: string): bigint {
  const [id, exp, signature] = token.split(".");
  const expires = parseInt(exp ?? "", 36);
  if (!/^\d+$/.test(id ?? "") || !Number.isFinite(expires) || !signature) throw BadRequestError("That isn't a player's QR code");
  const playerId = BigInt(id);
  const expected = Buffer.from(sign(playerId, expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw BadRequestError("That isn't a player's QR code");
  }
  if (Date.now() > expires) throw BadRequestError("A QR code has expired — ask the player to open My QR code again");
  return playerId;
}

// A team's "add players" rows as the services take them: a scanned QR code
// becomes the player it was signed for.
export function teamRows(rows: ({ mobile: string; name?: string } | { playerQr: string })[]) {
  return rows.map((row) => ("playerQr" in row ? { playerId: playerFromQr(row.playerQr) } : row));
}
