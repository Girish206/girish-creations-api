export interface AdminTokenPayload {
  sub: string;
  email: string;
  name: string | null;
  isOwner: boolean;
  // Effective flag (owner or granted). Missing on tokens issued before it
  // existed — read it through isSuperAdmin() in middleware/auth.ts.
  isSuperAdmin?: boolean;
  hasPortfolioAccess: boolean;
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
      // Set by middleware/portfolioScope.ts for portfolio routes.
      portfolioProfileId?: bigint;
    }
  }
}

export {};
