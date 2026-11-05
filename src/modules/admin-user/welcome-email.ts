import type { EmailMessage } from "../../lib/email";
import {
  BRANDS,
  button,
  detailsPanel,
  escapeHtml,
  featureList,
  finePrint,
  logoImages,
  paragraph,
  renderEmail,
  sectionHeading,
} from "../../lib/email-layout";
import type { AuthApp } from "../../types/express";

export interface WelcomeAccount {
  email: string;
  mobile?: string | null;
  name?: string | null;
  isOwner: boolean;
  isSuperAdmin: boolean;
  hasPortfolioAccess: boolean;
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
  hasCricketAccess: boolean;
}

// Someone who only plays cricket has only ever heard of RunMitra.
export function welcomeAppFor(account: Omit<WelcomeAccount, "email">): AuthApp {
  const usesAdmin =
    account.isOwner ||
    account.isSuperAdmin ||
    account.hasPortfolioAccess ||
    account.hasExpensesAccess ||
    account.hasSavingsAccess;
  return usesAdmin || !account.hasCricketAccess ? "admin" : "cricket";
}

// Every app they can use, the one the email is from first. Someone who only
// plays cricket isn't sent a link to the admin, or the other way round.
function appsOf(account: Omit<WelcomeAccount, "email">): AuthApp[] {
  const main = welcomeAppFor(account);
  const other: AuthApp = main === "admin" ? "cricket" : "admin";
  const usesOther = other === "cricket" && account.hasCricketAccess;
  return usesOther ? [main, other] : [main];
}

function featuresOf(account: WelcomeAccount) {
  const features = [
    {
      on: account.hasPortfolioAccess,
      title: "Portfolio",
      description: "Build and update your public portfolio.",
    },
    {
      on: account.hasExpensesAccess,
      title: "Expenses",
      description: "Record spending, split costs and settle up with others.",
    },
    {
      on: account.hasSavingsAccess,
      title: "Savings",
      description: "Set savings goals and keep track of contributions.",
    },
    {
      on: account.hasCricketAccess,
      title: "RunMitra",
      description: "Follow your matches, tournaments and cricket stats.",
    },
  ];
  return features.filter((feature) => feature.on);
}

// Sent only when someone chooses to from the admin side. The password is never
// included: they use the one they were given, or set their own with a code.
export function buildWelcomeEmail(account: WelcomeAccount, appUrls: Partial<Record<AuthApp, string>> = {}): EmailMessage {
  const brand = BRANDS[welcomeAppFor(account)];
  const firstName = account.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const title = `Welcome to ${brand.name}`;
  const intro = "Your account is ready. Here's what's included and how to sign in.";
  const features = featuresOf(account);
  const passwordHelp =
    "Use the password you were given or already have. To choose a new one, select Forgot password on the sign-in page and we'll email you a code.";
  const security = "For your security, we never send passwords by email and will never ask you for yours.";
  const help = "Need a hand? Just reply to this email and we'll help you out.";
  const appLinks = appsOf(account).flatMap((app) => {
    const url = appUrls[app];
    return url ? [{ brand: BRANDS[app], url }] : [];
  });

  return {
    fromName: brand.name,
    to: [{ address: account.email, name: account.name ?? undefined }],
    subject: title,
    inlineImages: logoImages(brand),
    clientReference: "welcome",
    textBody: [
      greeting,
      "",
      intro,
      ...(features.length
        ? ["", "WHAT'S INCLUDED", ...features.map((feature) => `- ${feature.title}: ${feature.description}`)]
        : []),
      "",
      "HOW TO SIGN IN",
      `Email: ${account.email}`,
      ...(account.mobile ? [`Or mobile: ${account.mobile}`] : []),
      `Password: ${passwordHelp}`,
      ...(appLinks.length ? ["", ...appLinks.map((app) => `Sign in to ${app.brand.name}: ${app.url}`)] : []),
      "",
      security,
      help,
      "",
      "Welcome aboard,",
      `The ${brand.name} team`,
    ].join("\n"),
    htmlBody: renderEmail({
      brand,
      title,
      preheader: intro,
      body: [
        paragraph(escapeHtml(greeting)),
        paragraph(intro),
        ...(features.length
          ? [
              sectionHeading("What's included"),
              featureList(brand, features),
            ]
          : []),
        sectionHeading("How to sign in"),
        detailsPanel(brand, [
          { label: "Email", value: escapeHtml(account.email) },
          ...(account.mobile ? [{ label: "Or mobile", value: escapeHtml(account.mobile) }] : []),
          { label: "Password", value: passwordHelp },
        ]),
        ...appLinks.map((app) => button(app.brand, `Sign in to ${app.brand.name}`, app.url)),
        ...(appLinks.length
          ? [
              finePrint(
                appLinks
                  .map((app) => {
                    const url = escapeHtml(app.url);
                    return `${app.brand.name}: <a href="${url}" style="color: ${app.brand.accent}">${url}</a>`;
                  })
                  .join("<br>"),
              ),
            ]
          : []),
        finePrint(`${security}<br>${help}`),
        paragraph(`Welcome aboard,<br><strong>The ${brand.name} team</strong>`),
      ].join("\n"),
      footer: `You're receiving this because this email address is linked to a ${brand.name} account. Not expecting it? Reply and let us know.`,
    }),
  };
}
