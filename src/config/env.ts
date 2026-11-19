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
  // Access tokens are short-lived; the app swaps its refresh token for a new
  // one whenever it expires, so nobody is signed out by this.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
  // Refresh tokens: renewed on every refresh (sliding), so someone only signs
  // in again after this long without opening the app.
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "90d",
  // "Keep me signed in" sessions: renewed on every refresh, so someone only
  // signs in again after this long away.
  jwtRememberExpiresIn: process.env.JWT_REMEMBER_EXPIRES_IN ?? "90d",
  adminSeedEmail: process.env.ADMIN_SEED_EMAIL,
  adminSeedPassword: process.env.ADMIN_SEED_PASSWORD,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Where the sign-in links in emails go.
  adminSignInUrl: process.env.ADMIN_SIGN_IN_URL?.trim() || "https://girish-creations.vercel.app/admin",
};
