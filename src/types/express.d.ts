export interface AdminTokenPayload {
  sub: string;
  // Null for an account that signs in with its mobile number only.
  email: string | null;
  name: string | null;
  isOwner: boolean;
  // Effective flag (owner or granted). Missing on tokens issued before it
  // existed — read it through isSuperAdmin() in middleware/auth.ts.
  isSuperAdmin?: boolean;
  hasPortfolioAccess: boolean;
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
  // Missing on tokens issued before it existed (= false).
  hasCricketAccess?: boolean;
  // A long-lived "keep me signed in" session (env.jwtRememberExpiresIn);
  // refreshing keeps it long-lived.
  remember?: boolean;
  // The account's sessionVersion when this was issued (missing = 0).
  sv?: number;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
      // Set by middleware/portfolioScope.ts for portfolio routes.
      portfolioProfileId?: bigint;
      // True when a visitor is reading /portfolios/:username (rather than
      // the owner editing it), so private fields can be left out.
      portfolioIsPublic?: boolean;
    }
  }
}

export {};
