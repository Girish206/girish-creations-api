import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export async function listTool(userProfileId: bigint) {
  return prisma.tool.findMany({ where: { userProfileId } });
}

export interface ToolInput {
  toolName: string;
  userProfileId: bigint;
}

export async function createTool(input: ToolInput) {
  return prisma.tool.create({
    data: {
      toolName: input.toolName,
      userProfileId: input.userProfileId,
    },
  });
}

export async function updateTool(id: bigint, userProfileId: bigint, input: Partial<ToolInput>) {
  const existing = await prisma.tool.findFirst({ where: { id, userProfileId } });
  if (!existing) {
    throw NotFoundError("Tool not found");
  }

  return prisma.tool.update({
    where: { id },
    data: { ...input },
  });
}

export async function deleteTool(id: bigint, userProfileId: bigint) {
  const existing = await prisma.tool.findFirst({ where: { id, userProfileId } });
  if (!existing) {
    throw NotFoundError("Tool not found");
  }
  await prisma.tool.delete({ where: { id } });
}
