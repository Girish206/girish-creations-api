import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { inningsSummary, oversText } from "./cricket.scoring";

// Link previews for shared Crickverse links. Chat apps (WhatsApp, Telegram,
// ...) build a link's card from <meta property="og:*"> tags in the page's
// HTML without running any script, and the app is a single-page app whose
// index.html is the same for every page. So the client's hosting
// (vercel.json) sends those apps' requests for a tournament, team or match
// page here, and this answers with a tiny page carrying that page's title,
// description and picture. People still get the app.

const SITE = "CricDesk";
const DEFAULT_TITLE = SITE;
const DEFAULT_DESCRIPTION =
  "Run your cricket tournaments: squads, balanced teams, ball-by-ball live scoring, scorecards and leaderboards.";
// In the client's public/ folder.
const DEFAULT_IMAGE = "/og-image.jpg?v=2";
const TIME_ZONE = "Asia/Kolkata";

interface Preview {
  title: string;
  description: string;
  // Site-relative or absolute.
  image: string;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const shortDate = (date: Date) =>
  date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE });

const dateTime = (date: Date) =>
  date.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });

// An uploaded image (/api/files/<id>) chat apps can show — they don't show
// SVGs — else the app's own card.
async function previewImage(...urls: (string | null)[]) {
  for (const url of urls) {
    const id = url?.match(/^\/api\/files\/(\d+)$/)?.[1];
    if (!id) continue;
    const file = await prisma.storedFile.findUnique({ where: { id: BigInt(id) }, select: { contentType: true } });
    if (file && /^image\/(jpe?g|png|webp|gif)$/.test(file.contentType)) return url!;
  }
  return DEFAULT_IMAGE;
}

async function tournamentPreview(id: bigint, teamIndex: number | null): Promise<Preview | null> {
  const tournament = await prisma.cricketTournament.findUnique({ where: { id } });
  if (!tournament) return null;
  const dates = tournament.startDate
    ? `${shortDate(tournament.startDate)}${
        tournament.endDate && tournament.endDate.getTime() !== tournament.startDate.getTime()
          ? ` – ${shortDate(tournament.endDate)}`
          : ""
      }`
    : null;
  const place = [tournament.ground, tournament.city].filter(Boolean).join(", ");
  const image = await previewImage(tournament.bannerUrl, tournament.logoUrl);

  const team = teamIndex === null ? null : tournament.teams[teamIndex];
  if (team) {
    return {
      title: `${team.name} · ${tournament.name}`,
      description: [`${team.playerIds.length} players`, dates, place].filter(Boolean).join(" · "),
      image,
    };
  }
  const teams = tournament.teams.length;
  return {
    title: tournament.name,
    description:
      [dates, place, teams ? `${teams} teams` : null].filter(Boolean).join(" · ") ||
      "Fixtures, live scores, standings and leaderboards",
    image,
  };
}

async function matchPreview(id: bigint): Promise<Preview | null> {
  const match = await prisma.cricketMatch.findUnique({ where: { id } });
  if (!match) return null;
  const tournament = match.tournamentId
    ? await prisma.cricketTournament.findUnique({ where: { id: match.tournamentId } })
    : null;
  const [a, b] = match.teams;
  // "Strikers 142/6 (20.0)" for each side that has batted.
  const scores = match.innings.map((innings) => {
    const total = inningsSummary(innings.balls);
    return `${match.teams[innings.battingTeam]?.name ?? "Team"} ${total.runs}/${total.wickets} (${oversText(total.legalBalls)})`;
  });
  const where = [match.venue, match.city].filter(Boolean).join(", ");

  let lead: string;
  if (match.status === "live") lead = ["🔴 Live", ...scores].join(" · ");
  else if (match.status === "completed" || match.status === "abandoned")
    lead = [match.resultText ?? (match.status === "abandoned" ? "No result" : "Completed"), ...scores].join(" · ");
  else lead = [match.scheduledAt ? dateTime(match.scheduledAt) : "Upcoming", where].filter(Boolean).join(" · ");

  return {
    title: `${a?.name ?? "Team A"} vs ${b?.name ?? "Team B"}${tournament ? ` · ${tournament.name}` : ""}`,
    description: `${lead} · ${match.overs} overs`,
    image: await previewImage(tournament?.bannerUrl ?? null, tournament?.logoUrl ?? null),
  };
}

async function previewFor(path: string): Promise<Preview | null> {
  const team = path.match(/^\/tournaments\/(\d+)\/teams\/(\d+)\/?$/);
  if (team) return tournamentPreview(BigInt(team[1]), Number(team[2]));
  const tournament = path.match(/^\/tournaments\/(\d+)\/?$/);
  if (tournament) return tournamentPreview(BigInt(tournament[1]), null);
  const match = path.match(/^\/matches\/(\d+)\/?$/);
  if (match) return matchPreview(BigInt(match[1]));
  return null;
}

// GET /api/cricket-preview?host=<site host>&path=/tournaments/19
export async function cricketPreviewHandler(req: Request, res: Response) {
  // The site's own host, passed on by the rewrite (only a plain host name,
  // so it can't point the card anywhere odd).
  const rawHost = String(req.query.host ?? req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  const host = /^[a-z0-9.-]+(:\d+)?$/i.test(rawHost) ? rawHost : null;
  const origin = host ? `${/^(localhost|127\.)/.test(host) ? "http" : "https"}://${host}` : "";
  const rawPath = String(req.query.path ?? "/");
  const path = `/${rawPath.replace(/^\/+/, "").split(/[?#]/)[0]}`;

  const preview = (await previewFor(path).catch(() => null)) ?? {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_IMAGE,
  };
  const url = `${origin}${path}`;
  const image = preview.image.startsWith("http") ? preview.image : `${origin}${preview.image}`;
  const [title, description] = [escapeHtml(preview.title), escapeHtml(preview.description)];

  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(SITE)}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${escapeHtml(url)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(url)}" />
</head>
<body><a href="${escapeHtml(url)}">${title}</a></body>
</html>`);
}
