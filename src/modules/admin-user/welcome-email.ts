import type { EmailMessage } from "../../lib/email";
import {
  BRAND,
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

export interface WelcomeAccount {
  email: string;
  mobile?: string | null;
  name?: string | null;
  isOwner: boolean;
  isSuperAdmin: boolean;
  hasPortfolioAccess: boolean;
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
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
  ];
  return features.filter((feature) => feature.on);
}

// Sent only when someone chooses to from the admin side. The password is never
// included: they use the one they were given, or set their own with a code.
export function buildWelcomeEmail(account: WelcomeAccount, signInUrl?: string): EmailMessage {
  const brand = BRAND;
  const firstName = account.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const title = `Welcome to ${brand.name}`;
  const intro = "Your account is ready. Here's what's included and how to sign in.";
  const features = featuresOf(account);
  const passwordHelp =
    "Use the password you were given or already have. To choose a new one, select Forgot password on the sign-in page and we'll email you a code.";
  const security = "For your security, we never send passwords by email and will never ask you for yours.";
  const help = "Need a hand? Just reply to this email and we'll help you out.";
  const signInLabel = `Sign in to ${brand.name}`;

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
      ...(signInUrl ? ["", `${signInLabel}: ${signInUrl}`] : []),
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
        ...(signInUrl
          ? [
              button(brand, signInLabel, signInUrl),
              finePrint(
                `${brand.name}: <a href="${escapeHtml(signInUrl)}" style="color: ${brand.accent}">${escapeHtml(signInUrl)}</a>`,
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
