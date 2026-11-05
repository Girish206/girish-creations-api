import { EmailError, isEmailEnabled, sendEmail } from "../../lib/email";
import { prisma } from "../../lib/prisma";
import { buildContactEmail } from "./contact-email";
import { NotFoundError } from "../../utils/httpError";

export interface ContactListParams {
  skip: number;
  take: number;
}

export async function listContactMessages(userProfileId: bigint, { skip, take }: ContactListParams) {
  const [items, total] = await Promise.all([
    prisma.contactMessage.findMany({ where: { userProfileId }, orderBy: { sentAt: "desc" }, skip, take }),
    prisma.contactMessage.count({ where: { userProfileId } }),
  ]);
  return { items, total };
}

export interface ContactInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  userProfileId: bigint;
}

export async function createContactMessage(input: ContactInput) {
  const created = await prisma.contactMessage.create({
    data: {
      name: input.name,
      email: input.email,
      subject: input.subject,
      message: input.message,
      userProfileId: input.userProfileId,
    },
  });
  await notifyOwner(created.id, input);
  return created;
}

// The message is already saved in the admin panel, so a failed email is only
// logged: the visitor's message did get through. (Logs the error, never what
// they wrote.)
async function notifyOwner(id: bigint, input: ContactInput) {
  if (!isEmailEnabled()) return;
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: input.userProfileId },
      select: { email: true, fullName: true },
    });
    if (!profile?.email) return;
    await sendEmail(buildContactEmail({ ...input, id }, { address: profile.email, name: profile.fullName }));
  } catch (error) {
    const reason = error instanceof EmailError ? `${error.code}: ${error.message}` : error;
    console.error(`Couldn't email the owner about contact message ${id}:`, reason);
  }
}

export async function deleteContactMessage(id: bigint, userProfileId: bigint) {
  const existing = await prisma.contactMessage.findFirst({ where: { id, userProfileId } });
  if (!existing) {
    throw NotFoundError("Contact message not found");
  }
  await prisma.contactMessage.delete({ where: { id } });
}
