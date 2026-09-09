import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export async function listCertification() {
  return prisma.certificationDetails.findMany({ orderBy: { issueDate: "desc" } });
}

export interface CertificationInput {
  name: string;
  issuingOrganization: string;
  issueDate: string;
  expirationDate?: string | null;
  credentialId?: string | null;
  credentialUrl?: string | null;
  userProfileId: bigint;
}

export async function createCertification(input: CertificationInput) {
  return prisma.certificationDetails.create({
    data: {
      name: input.name,
      issuingOrganization: input.issuingOrganization,
      issueDate: new Date(input.issueDate),
      expirationDate: input.expirationDate ? new Date(input.expirationDate) : null,
      credentialId: input.credentialId,
      credentialUrl: input.credentialUrl,
      userProfileId: input.userProfileId,
    },
  });
}

export async function updateCertification(id: bigint, input: Partial<CertificationInput>) {
  const existing = await prisma.certificationDetails.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Certification entry not found");
  }

  return prisma.certificationDetails.update({
    where: { id },
    data: {
      ...input,
      issueDate: input.issueDate ? new Date(input.issueDate) : undefined,
      expirationDate:
        input.expirationDate !== undefined ? (input.expirationDate ? new Date(input.expirationDate) : null) : undefined,
    },
  });
}

export async function deleteCertification(id: bigint) {
  const existing = await prisma.certificationDetails.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Certification entry not found");
  }
  await prisma.certificationDetails.delete({ where: { id } });
}
