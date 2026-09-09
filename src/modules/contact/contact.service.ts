import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export interface ContactListParams {
  skip: number;
  take: number;
}

export async function listContactMessages({ skip, take }: ContactListParams) {
  const [items, total] = await Promise.all([
    prisma.contactMessage.findMany({ orderBy: { sentAt: "desc" }, skip, take }),
    prisma.contactMessage.count(),
  ]);
  return { items, total };
}

export interface ContactInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  userProfileId: bigint | null;
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

export async function deleteContactMessage(id: bigint) {
  const existing = await prisma.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Contact message not found");
  }
  await prisma.contactMessage.delete({ where: { id } });
}
