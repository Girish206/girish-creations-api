import { prisma } from "../../lib/prisma";
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
  return prisma.contactMessage.create({
    data: {
      name: input.name,
      email: input.email,
      subject: input.subject,
      message: input.message,
      userProfileId: input.userProfileId,
    },
  });
}

export async function deleteContactMessage(id: bigint, userProfileId: bigint) {
  const existing = await prisma.contactMessage.findFirst({ where: { id, userProfileId } });
  if (!existing) {
    throw NotFoundError("Contact message not found");
  }
  await prisma.contactMessage.delete({ where: { id } });
}
