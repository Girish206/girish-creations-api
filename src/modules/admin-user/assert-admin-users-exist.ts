import { prisma } from "../../lib/prisma";
import { BadRequestError } from "../../utils/httpError";

// MongoDB has no foreign keys, and a required relation pointing at a missing
// person would break every list that includes it — so check before saving.
export async function assertAdminUsersExist(ids: bigint[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  const found = await prisma.adminUser.count({ where: { id: { in: uniqueIds } } });
  if (found !== uniqueIds.length) {
    throw BadRequestError("One of the selected people doesn't exist");
  }
}
