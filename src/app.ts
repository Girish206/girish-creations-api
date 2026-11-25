import express from "express";
import { corsMiddleware } from "./config/cors";
import { appBuildHeader } from "./middleware/appBuild";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { adminRouter, publicRouter } from "./routes";

export const app = express();

app.use(corsMiddleware);
app.use(appBuildHeader);
// The split-up email carries the app's pictures of the split (base64 JPEGs),
// more than the 100 kB default allows. (Vercel caps a request at 4.5 MB.)
app.use("/api/admin/expense-groups/:id/split-email", express.json({ limit: "4mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploaded files are stored in MongoDB and served by GET /api/files/:id
// (see modules/file) — no local /uploads static route needed anymore.

app.get("/api/health", (_req, res) => res.json({ data: { status: "ok" } }));
app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);

app.use(notFound);
app.use(errorHandler);

// Vercel runs the app as a serverless function from this default export;
// locally, src/server.ts imports `app` and calls listen() instead.
export default app;
