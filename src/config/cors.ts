import cors from "cors";
import { env } from "./env";

export const corsMiddleware = cors({
  origin: env.corsOrigin,
  credentials: true,
});
