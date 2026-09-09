import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export async function listEducation() {
  return prisma.educationDetails.findMany({ orderBy: { startDate: "desc" } });
}

export interface EducationInput {
  course: string;
  institutionName: string;
  specialization?: string | null;
  startDate: string;
  endDate?: string | null;
  grade: number | string;
  userProfileId: bigint;
}

export async function createEducation(input: EducationInput) {
  return prisma.educationDetails.create({
    data: {
      course: input.course,
      institutionName: input.institutionName,
      specialization: input.specialization,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      grade: input.grade,
      userProfileId: input.userProfileId,
    },
  });
}

export async function updateEducation(id: bigint, input: Partial<EducationInput>) {
  const existing = await prisma.educationDetails.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Education entry not found");
  }

  return prisma.educationDetails.update({
    where: { id },
    data: {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined,
    },
  });
}

export async function deleteEducation(id: bigint) {
  const existing = await prisma.educationDetails.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Education entry not found");
  }
  await prisma.educationDetails.delete({ where: { id } });
}
