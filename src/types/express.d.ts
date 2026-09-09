export interface AdminTokenPayload {
  sub: string;
  email: string;
  name: string | null;
  isOwner: boolean;
  hasPortfolioAccess: boolean;
  hasExpensesAccess: boolean;
  hasInvestmentsAccess: boolean;
  hasSavingsAccess: boolean;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
    }
  }
}

export {};
