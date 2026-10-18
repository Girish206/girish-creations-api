import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";
import { deleteUploadedFile } from "../../middleware/upload";

export interface ProjectListParams {
  skip: number;
  take: number;
}

export async function listProjects({ skip, take }: ProjectListParams) {
  const [items, total] = await Promise.all([
    prisma.projectDetails.findMany({ orderBy: { startDate: "desc" }, skip, take }),
    prisma.projectDetails.count(),
  ]);
  return { items, total };
}

export async function randomProjects(count: number) {
  const all = await prisma.projectDetails.findMany();
  return all.sort(() => Math.random() - 0.5).slice(0, count);
}

export async function getProjectById(id: bigint) {
  const project = await prisma.projectDetails.findUnique({ where: { id } });
  if (!project) {
    throw NotFoundError("Project not found");
  }
  return project;
}

export interface ProjectInput {
  title: string;
  description: string;
  technologiesUsed: string;
  projectUrl?: string | null;
  image?: string | null;
  startDate: string;
  endDate?: string | null;
  userProfileId: bigint;
}

export async function createProject(input: ProjectInput) {
  return prisma.projectDetails.create({
    data: {
      title: input.title,
      description: input.description,
      technologiesUsed: input.technologiesUsed,
      projectUrl: input.projectUrl,
      image: input.image,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      userProfileId: input.userProfileId,
    },
  });
}

export async function updateProject(id: bigint, input: Partial<Omit<ProjectInput, "userProfileId">>) {
  const existing = await getProjectById(id);

  const updated = await prisma.projectDetails.update({
    where: { id },
    data: {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined,
    },
  });
  if (input.image !== undefined && input.image !== existing.image) {
    await deleteUploadedFile(existing.image);
  }
  return updated;
}

export async function deleteProject(id: bigint) {
  const existing = await getProjectById(id);
  await prisma.projectDetails.delete({ where: { id } });
  await deleteUploadedFile(existing.image);
}
