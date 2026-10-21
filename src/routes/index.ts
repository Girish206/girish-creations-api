import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess, requireSuperAdmin } from "../middleware/auth";
import { resolveOwnPortfolio, resolvePublicPortfolio } from "../middleware/portfolioScope";
import { authRouter } from "../modules/auth/auth.routes";
import { profileAdminRouter, profilePublicRouter } from "../modules/profile/profile.routes";
import { listManageablePortfoliosHandler, listPortfoliosHandler } from "../modules/profile/profile.controller";
import { experienceAdminRouter, experiencePublicRouter } from "../modules/experience/experience.routes";
import { educationAdminRouter, educationPublicRouter } from "../modules/education/education.routes";
import {
  certificationAdminRouter,
  certificationPublicRouter,
} from "../modules/certification/certification.routes";
import { skillAdminRouter, skillPublicRouter } from "../modules/skill/skill.routes";
import { toolAdminRouter, toolPublicRouter } from "../modules/tool/tool.routes";
import { projectAdminRouter, projectPublicRouter } from "../modules/project/project.routes";
import { blogAdminRouter, blogPublicRouter } from "../modules/blog/blog.routes";
import { contactAdminRouter, contactPublicRouter } from "../modules/contact/contact.routes";
import { filePublicRouter } from "../modules/file/file.routes";
import { adminUserAdminRouter, expenseMembersAdminRouter } from "../modules/admin-user/admin-user.routes";
import { expenseCategoryAdminRouter } from "../modules/expense-category/expense-category.routes";
import { expenseGroupAdminRouter } from "../modules/expense-group/expense-group.routes";
import { expenseAdminRouter } from "../modules/expense/expense.routes";
import { savingsGoalAdminRouter } from "../modules/savings-goal/savings-goal.routes";
import { cricketAdminRouter } from "../modules/cricket/cricket.routes";

// Read-only portfolio endpoints. Each handler reads the portfolio a request
// is about from req.portfolioProfileId, so the same router serves a visitor
// viewing /<username> and an admin loading their own data to edit.
const portfolioReadRouter = Router();
portfolioReadRouter.use("/profile", profilePublicRouter);
portfolioReadRouter.use("/experience", experiencePublicRouter);
portfolioReadRouter.use("/education", educationPublicRouter);
portfolioReadRouter.use("/certifications", certificationPublicRouter);
portfolioReadRouter.use("/skills", skillPublicRouter);
portfolioReadRouter.use("/tools", toolPublicRouter);
portfolioReadRouter.use("/projects", projectPublicRouter);
portfolioReadRouter.use("/blog", blogPublicRouter);

const publicPortfolioRouter = Router();
publicPortfolioRouter.use(portfolioReadRouter);
publicPortfolioRouter.use("/contact", contactPublicRouter);

export const publicRouter = Router();
publicRouter.get("/portfolios", asyncHandler(listPortfoliosHandler));
publicRouter.use("/portfolios/:username", asyncHandler(resolvePublicPortfolio), publicPortfolioRouter);
publicRouter.use("/files", filePublicRouter);

// Signed-in account with portfolio access, scoped to its own portfolio.
const ownPortfolio = [requireAdminAuth, requireModuleAccess("portfolio"), asyncHandler(resolveOwnPortfolio)];

export const adminRouter = Router();
adminRouter.use("/auth", authRouter);
// The portfolio picker's choices for super admins.
adminRouter.get(
  "/portfolio-accounts",
  requireAdminAuth,
  requireModuleAccess("portfolio"),
  requireSuperAdmin,
  asyncHandler(listManageablePortfoliosHandler),
);
adminRouter.use("/portfolio", ...ownPortfolio, portfolioReadRouter);
adminRouter.use("/profile", ...ownPortfolio, profileAdminRouter);
adminRouter.use("/experience", ...ownPortfolio, experienceAdminRouter);
adminRouter.use("/education", ...ownPortfolio, educationAdminRouter);
adminRouter.use("/certifications", ...ownPortfolio, certificationAdminRouter);
adminRouter.use("/skills", ...ownPortfolio, skillAdminRouter);
adminRouter.use("/tools", ...ownPortfolio, toolAdminRouter);
adminRouter.use("/projects", ...ownPortfolio, projectAdminRouter);
adminRouter.use("/blog", ...ownPortfolio, blogAdminRouter);
adminRouter.use("/contact", ...ownPortfolio, contactAdminRouter);
adminRouter.use("/admin-users", adminUserAdminRouter);
adminRouter.use("/expense-members", expenseMembersAdminRouter);
adminRouter.use("/expense-categories", expenseCategoryAdminRouter);
adminRouter.use("/expense-groups", expenseGroupAdminRouter);
adminRouter.use("/expenses", expenseAdminRouter);
adminRouter.use("/savings-goals", savingsGoalAdminRouter);
adminRouter.use("/cricket", cricketAdminRouter);
