import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  // "Keep me signed in" sessions (CricDesk): renewed on every app open,
  // so a player only signs in again after this long away.
  jwtRememberExpiresIn: process.env.JWT_REMEMBER_EXPIRES_IN ?? "90d",
  adminSeedEmail: process.env.ADMIN_SEED_EMAIL,
  adminSeedPassword: process.env.ADMIN_SEED_PASSWORD,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // The welcome email's button. Without one, it just leaves the button out.
  signInUrls: {
    admin: process.env.ADMIN_SIGN_IN_URL?.trim() || undefined,
    cricket: process.env.RUNMITRA_SIGN_IN_URL?.trim() || undefined,
  },
};
