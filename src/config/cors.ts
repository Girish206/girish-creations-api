import cors from "cors";
import { env } from "./env";

// The RunMitra Android app (Capacitor) loads its pages from the phone
// itself, so its API calls come from this address rather than a website's.
// (capacitor://localhost is the same for an iPhone build.) Sign-in is a
// bearer token, not a cookie, so allowing them lets no other site act as
// a signed-in user.
const APP_ORIGINS = ["https://localhost", "capacitor://localhost"];

// CORS_ORIGIN: one website address, or several separated by commas.
const siteOrigins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsMiddleware = cors({
  origin: [...siteOrigins, ...APP_ORIGINS],
  credentials: true,
});
