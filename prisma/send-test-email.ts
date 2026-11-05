// Checks the ZeptoMail setup by sending real test emails, one in each app's
// look, built from the templates people actually receive:
//   npm run email:test -- you@example.com
import { env } from "../src/config/env";
import { EmailError, isEmailEnabled, sendEmail } from "../src/lib/email";
import { buildWelcomeEmail } from "../src/modules/admin-user/welcome-email";
import { buildCodeEmail } from "../src/modules/auth/auth-code";
import type { AuthApp } from "../src/types/express";

async function main() {
    const to = process.argv[2];
    if (!to) {
        console.error("Usage: npm run email:test -- you@example.com");
        process.exit(1);
    }
    if (!isEmailEnabled()) {
        console.error(
            "Email is off: set ZEPTOMAIL_TOKEN and ZEPTOMAIL_FROM_ADDRESS in .env first.",
        );
        process.exit(1);
    }
    const account = {
        email: to,
        isOwner: false,
        isSuperAdmin: false,
        hasPortfolioAccess: false,
        hasExpensesAccess: false,
        hasSavingsAccess: false,
        hasCricketAccess: true,
    };
    const emails = [
        ...(["admin", "cricket"] as AuthApp[]).map(
            // A made-up code: nothing is stored, so it can't sign anyone in.
            (app) => buildCodeEmail({ address: to }, "123456", "login", app),
        ),
        buildWelcomeEmail(
            {
                ...account,
                hasExpensesAccess: true,
                hasSavingsAccess: true,
                hasCricketAccess: false,
            },
            env.signInUrls,
        ),
        buildWelcomeEmail(account, env.signInUrls),
    ];
    for (const email of emails) {
        const requestId = await sendEmail({
            ...email,
            subject: `${email.subject}`,
            clientReference: "setup-test",
        });
        console.log(
            `Sent ${email.fromName} test email to ${to} (request ${requestId}).`,
        );
    }
    console.log("Check the inbox and the spam folder.");
}

main().catch((error: unknown) => {
    if (error instanceof EmailError) {
        console.error(`ZeptoMail refused it: ${error.message} (${error.code})`);
    } else {
        console.error(error);
    }
    process.exit(1);
});
