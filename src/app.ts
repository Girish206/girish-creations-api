import path from "node:path";
import express from "express";
import { corsMiddleware } from "./config/cors";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { adminRouter, publicRouter } from "./routes";

export const app = express();

app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.resolve(env.uploadsDir)));

app.get("/api/health", (_req, res) => res.json({ data: { status: "ok" } }));
app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);

app.use(notFound);
app.use(errorHandler);
