import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes";
import { profileAdminRouter, profilePublicRouter } from "../modules/profile/profile.routes";
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
import { adminUserAdminRouter, expenseMembersAdminRouter } from "../modules/admin-user/admin-user.routes";
import { expenseCategoryAdminRouter } from "../modules/expense-category/expense-category.routes";
import { expenseGroupAdminRouter } from "../modules/expense-group/expense-group.routes";
import { expenseAdminRouter } from "../modules/expense/expense.routes";
import { investmentAdminRouter } from "../modules/investment/investment.routes";
import { savingsGoalAdminRouter } from "../modules/savings-goal/savings-goal.routes";

export const publicRouter = Router();
publicRouter.use("/profile", profilePublicRouter);
publicRouter.use("/experience", experiencePublicRouter);
publicRouter.use("/education", educationPublicRouter);
publicRouter.use("/certifications", certificationPublicRouter);
publicRouter.use("/skills", skillPublicRouter);
publicRouter.use("/tools", toolPublicRouter);
publicRouter.use("/projects", projectPublicRouter);
publicRouter.use("/blog", blogPublicRouter);
publicRouter.use("/contact", contactPublicRouter);

export const adminRouter = Router();
adminRouter.use("/auth", authRouter);
adminRouter.use("/profile", profileAdminRouter);
adminRouter.use("/experience", experienceAdminRouter);
adminRouter.use("/education", educationAdminRouter);
adminRouter.use("/certifications", certificationAdminRouter);
adminRouter.use("/skills", skillAdminRouter);
adminRouter.use("/tools", toolAdminRouter);
adminRouter.use("/projects", projectAdminRouter);
adminRouter.use("/blog", blogAdminRouter);
adminRouter.use("/contact", contactAdminRouter);
adminRouter.use("/admin-users", adminUserAdminRouter);
adminRouter.use("/expense-members", expenseMembersAdminRouter);
adminRouter.use("/expense-categories", expenseCategoryAdminRouter);
adminRouter.use("/expense-groups", expenseGroupAdminRouter);
adminRouter.use("/expenses", expenseAdminRouter);
adminRouter.use("/investments", investmentAdminRouter);
adminRouter.use("/savings-goals", savingsGoalAdminRouter);
