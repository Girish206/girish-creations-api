import webpush from "web-push";
import type { CricketMatch } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { findMyPlayer } from "./cricket.service";
import { inningsSummary, oversText, ballsPerOver } from "./cricket.scoring";

// Web Push for CricDesk: a match starting, and its result, go to everyone
// in it, following it, or organising it. Free (the browsers' push services
// carry it); the keys are a VAPID pair (npx web-push generate-vapid-keys)
// in VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Without them nothing is sent.
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const enabled = Boolean(publicKey && privateKey);
if (enabled) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:hello@girishcreations.com", publicKey!, privateKey!);
}

export const pushPublicKey = () => publicKey ?? null;

export async function subscribe(adminId: bigint, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const existing = await prisma.cricketPushSubscription.findFirst({ where: { endpoint: sub.endpoint } });
  const data = { adminId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
  if (existing) await prisma.cricketPushSubscription.update({ where: { id: existing.id }, data });
  else await prisma.cricketPushSubscription.create({ data });
}

export async function unsubscribe(adminId: bigint, endpoint: string) {
  await prisma.cricketPushSubscription.deleteMany({ where: { adminId, endpoint } });
}

// Whether this account has notifications on in any browser.
export async function isSubscribed(adminId: bigint) {
  return (await prisma.cricketPushSubscription.count({ where: { adminId } })) > 0;
}

// The accounts to tell about a match: its players, whoever follows one of
// them, its tournament (or a team in it), and its and its tournament's
// organisers. Players reach their account through the shared mobile.
async function audienceOf(match: CricketMatch) {
  const playerIds = match.teams.flatMap((team) => team.playerIds);
  const follows = await prisma.cricketFollow.findMany({
    where: {
      OR: [
        { kind: "player", targetId: { in: playerIds } },
        ...(match.tournamentId !== null
          ? [
              { kind: "tournament", targetId: match.tournamentId },
              { kind: "team", targetId: match.tournamentId, teamIndex: { in: match.teams.map((team) => team.teamIndex) } },
            ]
          : []),
      ],
    },
    select: { followerId: true },
  });
  const players = await prisma.cricketPlayer.findMany({
    where: { id: { in: [...new Set([...playerIds, ...follows.map((f) => f.followerId)])] } },
    select: { mobile: true },
  });
  const mobiles = players.flatMap((player) => (player.mobile ? [player.mobile] : []));
  const accounts = await prisma.adminUser.findMany({ where: { mobile: { in: mobiles } }, select: { id: true } });
  const tournament = match.tournamentId
    ? await prisma.cricketTournament.findUnique({ where: { id: match.tournamentId }, select: { createdById: true } })
    : null;
  return [
    ...new Set(
      [...accounts.map((a) => a.id), match.createdById, tournament?.createdById].filter((id): id is bigint => id != null),
    ),
  ];
}

function messageFor(match: CricketMatch, kind: "started" | "result") {
  const [a, b] = match.teams.map((team) => team.name);
  if (kind === "started") return { title: `${a} vs ${b} is live`, body: "Follow it ball by ball on CricDesk." };
  const scores = match.innings
    .map((innings) => {
      const s = inningsSummary(innings.balls);
      return `${match.teams[innings.battingTeam].name} ${s.runs}/${s.wickets} (${oversText(s.legalBalls, ballsPerOver(match))})`;
    })
    .join(" · ");
  return { title: match.resultText ?? `${a} vs ${b}`, body: scores || `${a} vs ${b}` };
}

// Sends it to every browser of the audience, giving up after a few seconds
// (it runs inside the scorer's request). Subscriptions the push service
// says are gone are removed. Never throws: scoring mustn't fail over it.
export async function notifyMatch(match: CricketMatch, kind: "started" | "result", exceptAdminId?: bigint) {
  if (!enabled) return;
  try {
    const audience = (await audienceOf(match)).filter((id) => id !== exceptAdminId);
    const subs = await prisma.cricketPushSubscription.findMany({ where: { adminId: { in: audience } } });
    const payload = JSON.stringify({ ...messageFor(match, kind), url: `/matches/${match.id}`, tag: `match-${match.id}` });
    const send = Promise.allSettled(
      subs.map((sub) =>
        webpush
          .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600 })
          .catch(async (err: { statusCode?: number }) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await prisma.cricketPushSubscription.delete({ where: { id: sub.id } });
            }
          }),
      ),
    );
    await Promise.race([send, new Promise((resolve) => setTimeout(resolve, 4000))]);
  } catch (err) {
    console.error("Push failed", err);
  }
}

// Not used by the scoring path; kept with the other push helpers for the
// "Test notification" button.
export async function notifySelf(adminId: bigint) {
  if (!enabled) return false;
  const me = await findMyPlayer(adminId);
  const subs = await prisma.cricketPushSubscription.findMany({ where: { adminId } });
  const payload = JSON.stringify({
    title: "Notifications are on",
    body: `${me?.name ?? "You"}: you'll hear when your matches start and finish.`,
    url: "/",
    tag: "cricdesk-test",
  });
  await Promise.allSettled(
    subs.map((sub) => webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)),
  );
  return subs.length > 0;
}
