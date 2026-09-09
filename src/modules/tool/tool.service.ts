import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export async function listTool() {
  return prisma.tool.findMany();
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

export async function updateTool(id: bigint, input: Partial<ToolInput>) {
  const existing = await prisma.tool.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Tool not found");
  }

  return prisma.tool.update({
    where: { id },
    data: { ...input },
  });
}

export async function deleteTool(id: bigint) {
  const existing = await prisma.tool.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Tool not found");
  }
  await prisma.tool.delete({ where: { id } });
}
