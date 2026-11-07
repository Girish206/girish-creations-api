import cors from "cors";
import { env } from "./env";

// CORS_ORIGIN: one website address, or several separated by commas.
const siteOrigins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsMiddleware = cors({
  origin: siteOrigins,
  credentials: true,
});
