import { prisma } from "../../lib/prisma";
import { BadRequestError, NotFoundError } from "../../utils/httpError";
import { findMyPlayer } from "./cricket.service";

export type FollowKind = "player" | "team" | "tournament";

// What's followed: a player or tournament by id, or a team by its
// tournament's id plus its index (teamIndex is null for the other kinds).
export interface FollowTarget {
  kind: FollowKind;
  targetId: bigint;
  teamIndex: number | null;
}

async function myPlayerOrThrow(adminId: bigint) {
  const player = await findMyPlayer(adminId);
  if (!player) throw NotFoundError("Your account isn't linked to a player yet");
  return player;
}

async function assertTargetExists(target: FollowTarget, followerId: bigint) {
  if (target.kind === "player") {
    if (target.targetId === followerId) throw BadRequestError("You can't follow yourself");
    const player = await prisma.cricketPlayer.findUnique({ where: { id: target.targetId } });
    if (!player) throw NotFoundError("Player not found");
    return;
  }
  const tournament = await prisma.cricketTournament.findUnique({ where: { id: target.targetId } });
  if (!tournament) throw NotFoundError("Tournament not found");
  if (target.kind === "team" && (target.teamIndex ?? 0) >= tournament.teams.length) {
    throw NotFoundError("Team not found");
  }
}

const whereTarget = (target: FollowTarget) => ({
  kind: target.kind,
  targetId: target.targetId,
  teamIndex: target.teamIndex,
});

// The signed-in player's follows, newest first. playerId is null when the
// account has no player (and so can't follow anything).
export async function listMyFollows(adminId: bigint) {
  const player = await findMyPlayer(adminId);
  if (!player) return { playerId: null, follows: [] };
  const follows = await prisma.cricketFollow.findMany({
    where: { followerId: player.id },
    orderBy: { createdAt: "desc" },
  });
  return { playerId: player.id, follows };
}

// Following twice is a no-op.
export async function follow(adminId: bigint, target: FollowTarget) {
  const player = await myPlayerOrThrow(adminId);
  await assertTargetExists(target, player.id);
  const existing = await prisma.cricketFollow.findFirst({ where: { followerId: player.id, ...whereTarget(target) } });
  if (!existing) {
    await prisma.cricketFollow.create({ data: { followerId: player.id, ...whereTarget(target) } });
  }
  return listMyFollows(adminId);
}

export async function unfollow(adminId: bigint, target: FollowTarget) {
  const player = await myPlayerOrThrow(adminId);
  await prisma.cricketFollow.deleteMany({ where: { followerId: player.id, ...whereTarget(target) } });
  return listMyFollows(adminId);
}

// Who follows the target and, for a player, what they follow, newest
// first: the profile's Followers / Following lists (the app fills in the
// names from the players and tournaments it already has).
export async function followLists(target: FollowTarget) {
  const [followers, following] = await Promise.all([
    prisma.cricketFollow.findMany({ where: whereTarget(target), orderBy: { createdAt: "desc" } }),
    target.kind === "player"
      ? prisma.cricketFollow.findMany({ where: { followerId: target.targetId }, orderBy: { createdAt: "desc" } })
      : [],
  ]);
  return { followers, following };
}

// How many follow the target; for a player, also how many they follow.
export async function followCounts(target: FollowTarget) {
  const [followers, following] = await Promise.all([
    prisma.cricketFollow.count({ where: whereTarget(target) }),
    target.kind === "player" ? prisma.cricketFollow.count({ where: { followerId: target.targetId } }) : null,
  ]);
  return { followers, following };
}
