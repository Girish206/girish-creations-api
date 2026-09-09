import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export interface ListSkillOptions {
  levels?: string[];
  random?: number;
}

// Ported from the old Django view: optionally filter by proficiency level(s),
// then optionally take a random sample of `random` rows from the (filtered)
// set via a shuffle + slice, mirroring random.shuffle(list)[:n].
export async function listSkill(options: ListSkillOptions = {}) {
  const rows = await prisma.skill.findMany({
    where: options.levels && options.levels.length > 0 ? { proficiencyLevel: { in: options.levels } } : undefined,
  });

  if (options.random === undefined) {
    return rows;
  }

  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, options.random);
}

export interface SkillInput {
  skillName: string;
  proficiencyLevel: string;
  userProfileId: bigint;
}

export async function createSkill(input: SkillInput) {
  return prisma.skill.create({
    data: {
      skillName: input.skillName,
      proficiencyLevel: input.proficiencyLevel,
      userProfileId: input.userProfileId,
    },
  });
}

export async function updateSkill(id: bigint, input: Partial<SkillInput>) {
  const existing = await prisma.skill.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Skill not found");
  }

  return prisma.skill.update({
    where: { id },
    data: { ...input },
  });
}

export async function deleteSkill(id: bigint) {
  const existing = await prisma.skill.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Skill not found");
  }
  await prisma.skill.delete({ where: { id } });
}
