import "dotenv/config";
import { defineConfig } from "prisma/config";

// The datasource URL lives in schema.prisma (env("DATABASE_URL")) — Prisma 6's
// MongoDB connector reads it from there rather than from this config.
export default defineConfig({
  schema: "prisma/schema.prisma",
});
