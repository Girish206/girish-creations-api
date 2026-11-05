import "dotenv/config";

// Sends transactional email through ZeptoMail (Zoho's email API). Works only
// once ZEPTOMAIL_TOKEN and ZEPTOMAIL_FROM_ADDRESS are set; until then
// sendEmail() does nothing, so the app runs fine without an account.

// Tokens only work in their account's region: ".in" hosts for an India account,
// ".com" for the US one, and so on. ZEPTOMAIL_API_URL picks another.
const DEFAULT_API_URL = "https://cpaas.zoho.com/v1.1/email";

// The server may be serverless, so callers wait for the send to finish rather
// than leaving it running after the response. This caps how long that can take.
const SEND_TIMEOUT_MS = 8_000;

// Where replies go unless an email names someone else. ZEPTOMAIL_REPLY_TO picks
// another.
const DEFAULT_REPLY_TO = "runmithra@gmail.com";

function config() {
  // The console shows the token with its scheme in front; accept it either way.
  const token = process.env.ZEPTOMAIL_TOKEN?.trim().replace(/^zoho-enczapikey\s+/i, "");
  const fromAddress = process.env.ZEPTOMAIL_FROM_ADDRESS?.trim();
  if (!token || !fromAddress) return null;
  return {
    token,
    fromAddress,
    fromName: process.env.ZEPTOMAIL_FROM_NAME?.trim() || undefined,
    apiUrl: process.env.ZEPTOMAIL_API_URL?.trim() || DEFAULT_API_URL,
    replyTo: process.env.ZEPTOMAIL_REPLY_TO?.trim() || DEFAULT_REPLY_TO,
  };
}

export function isEmailEnabled() {
  return config() !== null;
}

export interface EmailAddress {
  address: string;
  name?: string;
}

export interface EmailMessage {
  // Who it appears to be from, in place of ZEPTOMAIL_FROM_NAME: both apps send
  // from the same address, but a player should see "RunMitra" in their inbox.
  fromName?: string;
  to: EmailAddress[];
  subject: string;
  // At least one body is required; send both so every mail client has one.
  textBody?: string;
  htmlBody?: string;
  // Only for replies meant for someone else, like a contact form's visitor.
  // Everything else goes to the default reply-to address.
  replyTo?: EmailAddress;
  inlineImages?: InlineImage[];
  // Your own reference for finding this email in ZeptoMail's logs.
  clientReference?: string;
}

// An image shown inside the email: the HTML refers to it as <img src="cid:...">.
export interface InlineImage {
  cid: string;
  mimeType: string;
  // Base64.
  content: string;
}

export class EmailError extends Error {
  constructor(
    message: string,
    // ZeptoMail's error code (e.g. "TM_3004") or HTTP status, for the logs.
    readonly code: string,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

// ZeptoMail reports errors as { data: { error_code, message } } or as
// { error: { code, message, details: [{ message }] } }. In the second, message
// is a vague "Access Denied" and details says what's actually wrong.
function describeFailure(status: number, body: unknown) {
  const parsed = (body ?? {}) as {
    data?: { error_code?: string; message?: string };
    error?: { code?: string; message?: string; details?: { message?: string }[] };
  };
  const code = parsed.error?.code ?? parsed.data?.error_code;
  const message = parsed.error?.details?.[0]?.message ?? parsed.error?.message ?? parsed.data?.message;
  return new EmailError(message || `ZeptoMail responded with ${status}`, code || String(status));
}

// Resolves to ZeptoMail's request id, or null if email isn't configured.
// Throws EmailError if it couldn't be sent.
export async function sendEmail(message: EmailMessage): Promise<string | null> {
  const settings = config();
  if (!settings) return null;

  const fromName = message.fromName ?? settings.fromName;
  const response = await fetch(settings.apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Zoho-enczapikey ${settings.token}`,
    },
    body: JSON.stringify({
      from: { address: settings.fromAddress, name: fromName },
      to: message.to.map((recipient) => ({ email_address: recipient })),
      reply_to: [message.replyTo ?? { address: settings.replyTo, name: fromName }],
      subject: message.subject,
      textbody: message.textBody,
      htmlbody: message.htmlBody,
      inline_images: message.inlineImages?.map((image) => ({
        cid: image.cid,
        mime_type: image.mimeType,
        content: image.content,
      })),
      client_reference: message.clientReference,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  }).catch((error: unknown) => {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new EmailError(timedOut ? "ZeptoMail took too long to respond" : "Couldn't reach ZeptoMail", "NETWORK");
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw describeFailure(response.status, body);
  return (body as { request_id?: string } | null)?.request_id ?? "";
}
