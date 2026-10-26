import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { upload } from "../../middleware/upload";
import { isSuperAdmin, requireAdminAuth, requireCricketAccess, requireSuperAdmin } from "../../middleware/auth";
import { rateLimit } from "../../middleware/rateLimit";
import { prisma } from "../../lib/prisma";
import { UnauthorizedError } from "../../utils/httpError";
import { z } from "zod";
import { isSubscribed, notifySelf, pushPublicKey, subscribe, unsubscribe } from "./cricket-push";
import { publicMatchHandler, publicMatchLiveHandler, publicTournamentHandler } from "./cricket-public.controller";
import { parseId } from "../../utils/parseId";
import { assertCanManageTournament, assertMatchAccess, type MatchAccess } from "./cricket.service";
import { assertScoringSeat } from "./cricket-match.service";
import { dbStatsHandler } from "./cricket-db-stats";
import {
  addTeamPlayersHandler,
  addFriendlyTeamPlayersHandler,
  listTeamPlayersHandler,
  addTeamsHandler,
  addFixturesHandler,
  clearFormatHandler,
  setFormatHandler,
  lookupPlayerHandler,
  lookupTeamPlayerHandler,
  createPlayerHandler,
  createPlayersBulkHandler,
  createTournamentHandler,
  deletePlayerHandler,
  deleteTournamentHandler,
  generateTeamsHandler,
  getTournamentHandler,
  grantPlayerLoginHandler,
  meHandler,
  myQrHandler,
  playerCareerHandler,
  revokePlayerLoginHandler,
  setTournamentOrganisersHandler,
  mergePlayersHandler,
  playerInviteHandler,
  resetPlayerLoginHandler,
  setMyPhotoHandler,
  signInLookupHandler,
  signUpHandler,
  updateMyProfileHandler,
  listPlayersHandler,
  listTournamentsHandler,
  movePlayerHandler,
  removeTeamHandler,
  setMatchSetsHandler,
  setPlayerPhotoHandler,
  setSquadHandler,
  setTournamentImagesHandler,
  swapPlayersHandler,
  updatePlayerHandler,
  updateTeamHandler,
  setTeamRolesHandler,
  setTournamentScorersHandler,
  updateTournamentHandler,
  viewerOf,
} from "./cricket.controller";
import {
  abandonMatchHandler,
  addBallHandler,
  changeSquadHandler,
  declareResultHandler,
  editBallHandler,
  isOrganiser,
  reopenMatchHandler,
  claimScoringHandler,
  createMatchHandler,
  deleteMatchHandler,
  endInningsHandler,
  getMatchHandler,
  matchLiveHandler,
  handOverScoringHandler,
  listMatchesHandler,
  listPlacesHandler,
  releaseScoringHandler,
  scorerOf,
  setCurrentPlayersHandler,
  setMatchScorersHandler,
  setPlayerOfMatchHandler,
  startMatchHandler,
  undoBallHandler,
  updateMatchHandler,
} from "./cricket-match.controller";
import { followCountsHandler, followHandler, listMyFollowsHandler, unfollowHandler } from "./cricket-follow.controller";
import {
  addSavedTeamPlayersHandler,
  createSavedTeamHandler,
  deleteSavedTeamHandler,
  invitePreviewHandler,
  joinTeamHandler,
  savedTeamInviteHandler,
  tournamentTeamInviteHandler,
  getSavedTeamHandler,
  setSavedTeamRolesHandler,
  updateSavedTeamHandler,
} from "./cricket-team.controller";

// Public sign-in lookup and sign-up for players (mounted outside the
// signed-in router).
export const cricketPublicRouter = Router();
// Rate limited per address: the lookup tells whether a number has an
// account, and sign-up checks invite codes (also limited per number, in
// the service).
cricketPublicRouter.post(
  "/sign-in/lookup",
  asyncHandler(rateLimit("signin-lookup", 30, 15 * 60_000)),
  asyncHandler(signInLookupHandler),
);
cricketPublicRouter.post("/register", asyncHandler(rateLimit("register", 15, 60 * 60_000)), asyncHandler(signUpHandler));
// Shared links to public matches and tournaments, signed out.
const publicLimit = asyncHandler(rateLimit("public-view", 900, 15 * 60_000));
cricketPublicRouter.get("/public/matches/:id", publicLimit, asyncHandler(publicMatchHandler));
cricketPublicRouter.get("/public/matches/:id/live", publicLimit, asyncHandler(publicMatchLiveHandler));
cricketPublicRouter.get("/public/tournaments/:id", publicLimit, asyncHandler(publicTournamentHandler));
cricketPublicRouter.get("/push/key", (_req, res) => {
  res.json({ data: { publicKey: pushPublicKey() } });
});

// Players with cricket access read their own stats, matches and
// tournaments (the handlers check which). Anyone can create a tournament or
// match and then manage it (manageTournament / manageMatch), adding players
// to their squads (POST /players); editing players and the rest is super admin.
export const cricketAdminRouter = Router();
// The token alone isn't trusted for long: the account must still be able
// to sign in, still have cricket access, and not have signed out everywhere
// since (sessionVersion). One small read per request.
const currentSession = asyncHandler(async (req, _res, next) => {
  const account = await prisma.adminUser.findUnique({
    where: { id: BigInt(req.admin!.sub) },
    select: { isActive: true, passwordHash: true, hasCricketAccess: true, isSuperAdmin: true, isOwner: true, sessionVersion: true },
  });
  const allowed =
    account?.isActive &&
    account.passwordHash !== null &&
    (account.hasCricketAccess || account.isSuperAdmin || account.isOwner) &&
    (req.admin!.sv ?? 0) === (account.sessionVersion ?? 0);
  if (!allowed) throw UnauthorizedError("This session has ended. Sign in again.");
  // Access taken away since the token was issued counts from now on.
  if (isSuperAdmin(req.admin) && !account.isSuperAdmin && !account.isOwner) {
    req.admin = { ...req.admin!, isSuperAdmin: false, isOwner: false };
  }
  next();
});
cricketAdminRouter.use(requireAdminAuth, requireCricketAccess, currentSession);
const admin = requireSuperAdmin;
const manageTournament = asyncHandler(async (req, _res, next) => {
  await assertCanManageTournament(parseId(req.params.id), viewerOf(req));
  next();
});
// See MatchAccess: organisers delete, captains also pick the scorers, and
// scorers edit and score.
const matchAccess = (needed: MatchAccess) =>
  asyncHandler(async (req, _res, next) => {
    await assertMatchAccess(parseId(req.params.id), viewerOf(req), needed);
    next();
  });
const organiseMatch = matchAccess("organise");
const captainMatch = matchAccess("captain");
const scoreMatch = matchAccess("score");
// Number → name lookups, limited per account so the player list can't be
// mapped number by number.
const lookupLimit = asyncHandler(rateLimit("player-lookup", 60, 60 * 60_000, (req) => req.admin!.sub));
// Only the one holding the scoring seat changes a live match's score.
const holdSeat = asyncHandler(async (req, _res, next) => {
  await assertScoringSeat(parseId(req.params.id), scorerOf(req), () => isOrganiser(req));
  next();
});

cricketAdminRouter.get("/me", asyncHandler(meHandler));
// The shared MongoDB database's size, collection by collection.
cricketAdminRouter.get("/db-stats", admin, asyncHandler(dbStatsHandler));
// This browser's match notifications (Web Push).
const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
cricketAdminRouter.get(
  "/push",
  asyncHandler(async (req, res) => {
    res.json({ data: { subscribed: await isSubscribed(BigInt(req.admin!.sub)), publicKey: pushPublicKey() } });
  }),
);
cricketAdminRouter.post(
  "/push",
  asyncHandler(async (req, res) => {
    await subscribe(BigInt(req.admin!.sub), pushSubscriptionSchema.parse(req.body));
    await notifySelf(BigInt(req.admin!.sub));
    res.status(204).send();
  }),
);
cricketAdminRouter.delete(
  "/push",
  asyncHandler(async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body ?? {});
    await unsubscribe(BigInt(req.admin!.sub), endpoint);
    res.status(204).send();
  }),
);
cricketAdminRouter.put("/me/profile", asyncHandler(updateMyProfileHandler));
cricketAdminRouter.get("/me/qr", asyncHandler(myQrHandler));
cricketAdminRouter.put("/me/photo", upload.fields([{ name: "photo", maxCount: 1 }]), asyncHandler(setMyPhotoHandler));
cricketAdminRouter.get("/players", asyncHandler(listPlayersHandler));
// Players browse every tournament to follow one (opening it needs a follow).
cricketAdminRouter.get("/tournaments", asyncHandler(listTournamentsHandler));
cricketAdminRouter.get("/tournaments/:id", asyncHandler(getTournamentHandler));
cricketAdminRouter.get("/follows", asyncHandler(listMyFollowsHandler));
cricketAdminRouter.get("/follows/counts", asyncHandler(followCountsHandler));
cricketAdminRouter.post("/follows", asyncHandler(followHandler));
cricketAdminRouter.delete("/follows", asyncHandler(unfollowHandler));
cricketAdminRouter.get("/matches", asyncHandler(listMatchesHandler));
cricketAdminRouter.get("/matches/:id", asyncHandler(getMatchHandler));
cricketAdminRouter.get("/matches/:id/live", asyncHandler(matchLiveHandler));
// Grounds and cities already used, suggested on the match / tournament forms.
cricketAdminRouter.get("/places", asyncHandler(listPlacesHandler));
// A team's captain adds players to it (the service checks who's asking).
cricketAdminRouter.get("/tournaments/:id/teams/:index/lookup", lookupLimit, asyncHandler(lookupTeamPlayerHandler));
cricketAdminRouter.post("/tournaments/:id/teams/:index/players", asyncHandler(addTeamPlayersHandler));
// A friendly team's captain adds players to its upcoming matches.
// Everyone in a team (?key=, see effectiveTeamKey), for a one-off side's squad picker.
cricketAdminRouter.get("/teams/players", asyncHandler(listTeamPlayersHandler));
cricketAdminRouter.post("/friendly-teams/players", asyncHandler(addFriendlyTeamPlayersHandler));
// Teams made outside any tournament: anyone can create one; its creator,
// its captain and super admins change it (the service checks who's asking).
cricketAdminRouter.post("/saved-teams", asyncHandler(createSavedTeamHandler));
cricketAdminRouter.get("/saved-teams/:id", asyncHandler(getSavedTeamHandler));
cricketAdminRouter.put("/saved-teams/:id", asyncHandler(updateSavedTeamHandler));
cricketAdminRouter.put("/saved-teams/:id/roles", asyncHandler(setSavedTeamRolesHandler));
cricketAdminRouter.post("/saved-teams/:id/players", asyncHandler(addSavedTeamPlayersHandler));
cricketAdminRouter.delete("/saved-teams/:id", asyncHandler(deleteSavedTeamHandler));
// Team join links: a team's managers get (GET) or replace (POST) its code;
// anyone signed in opens a link and joins (limited per account, so codes
// can't be guessed).
cricketAdminRouter.get("/saved-teams/:id/invite", asyncHandler(savedTeamInviteHandler));
cricketAdminRouter.post("/saved-teams/:id/invite", asyncHandler(savedTeamInviteHandler));
cricketAdminRouter.get("/tournaments/:id/teams/:index/invite", asyncHandler(tournamentTeamInviteHandler));
cricketAdminRouter.post("/tournaments/:id/teams/:index/invite", asyncHandler(tournamentTeamInviteHandler));
const joinLimit = asyncHandler(rateLimit("team-join", 60, 60 * 60_000, (req) => req.admin!.sub));
cricketAdminRouter.get("/join/:code", joinLimit, asyncHandler(invitePreviewHandler));
cricketAdminRouter.post("/join/:code", joinLimit, asyncHandler(joinTeamHandler));

// A one-off match's captain, found by mobile before adding them.
cricketAdminRouter.get("/players/lookup", lookupLimit, asyncHandler(lookupPlayerHandler));
// Anyone can open a player's profile (their matches and tournaments).
cricketAdminRouter.get("/players/:id/career", asyncHandler(playerCareerHandler));
cricketAdminRouter.post("/players", asyncHandler(createPlayerHandler));
cricketAdminRouter.post("/players/bulk", admin, asyncHandler(createPlayersBulkHandler));
cricketAdminRouter.put("/players/:id", admin, asyncHandler(updatePlayerHandler));
cricketAdminRouter.delete("/players/:id", admin, asyncHandler(deletePlayerHandler));
cricketAdminRouter.put(
  "/players/:id/photo",
  admin,
  upload.fields([{ name: "photo", maxCount: 1 }]),
  asyncHandler(setPlayerPhotoHandler),
);
cricketAdminRouter.put("/players/:id/login", admin, asyncHandler(grantPlayerLoginHandler));
cricketAdminRouter.delete("/players/:id/login", admin, asyncHandler(revokePlayerLoginHandler));
// The invite code a player enters to claim their record (whoever added them
// may ask), and a super admin's reset for a forgotten password.
cricketAdminRouter.get("/players/:id/invite", asyncHandler(playerInviteHandler));
cricketAdminRouter.post("/players/:id/login/reset", admin, asyncHandler(resetPlayerLoginHandler));
// One person added twice: everything of :id moves to intoId.
cricketAdminRouter.post("/players/:id/merge", admin, asyncHandler(mergePlayersHandler));

cricketAdminRouter.post("/tournaments", asyncHandler(createTournamentHandler));
cricketAdminRouter.put("/tournaments/:id", manageTournament, asyncHandler(updateTournamentHandler));
cricketAdminRouter.delete("/tournaments/:id", manageTournament, asyncHandler(deleteTournamentHandler));
cricketAdminRouter.put(
  "/tournaments/:id/images",
  manageTournament,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "banner", maxCount: 1 },
  ]),
  asyncHandler(setTournamentImagesHandler),
);
cricketAdminRouter.put("/tournaments/:id/players", manageTournament, asyncHandler(setSquadHandler));
cricketAdminRouter.put("/tournaments/:id/match-sets", manageTournament, asyncHandler(setMatchSetsHandler));
cricketAdminRouter.post("/tournaments/:id/generate", manageTournament, asyncHandler(generateTeamsHandler));
cricketAdminRouter.post("/tournaments/:id/swap", manageTournament, asyncHandler(swapPlayersHandler));
cricketAdminRouter.post("/tournaments/:id/move", manageTournament, asyncHandler(movePlayerHandler));
cricketAdminRouter.post("/tournaments/:id/teams", manageTournament, asyncHandler(addTeamsHandler));
cricketAdminRouter.put("/tournaments/:id/teams/:index", manageTournament, asyncHandler(updateTeamHandler));
cricketAdminRouter.put("/tournaments/:id/teams/:index/roles", manageTournament, asyncHandler(setTeamRolesHandler));
cricketAdminRouter.delete("/tournaments/:id/teams/:index", manageTournament, asyncHandler(removeTeamHandler));
cricketAdminRouter.put("/tournaments/:id/scorers", manageTournament, asyncHandler(setTournamentScorersHandler));
cricketAdminRouter.put("/tournaments/:id/organisers", manageTournament, asyncHandler(setTournamentOrganisersHandler));
cricketAdminRouter.put("/tournaments/:id/format", manageTournament, asyncHandler(setFormatHandler));
cricketAdminRouter.delete("/tournaments/:id/format", manageTournament, asyncHandler(clearFormatHandler));
cricketAdminRouter.post("/tournaments/:id/fixtures", manageTournament, asyncHandler(addFixturesHandler));

cricketAdminRouter.post("/matches", asyncHandler(createMatchHandler));
cricketAdminRouter.put("/matches/:id", scoreMatch, asyncHandler(updateMatchHandler));
cricketAdminRouter.delete("/matches/:id", organiseMatch, asyncHandler(deleteMatchHandler));
cricketAdminRouter.put("/matches/:id/scorers", captainMatch, asyncHandler(setMatchScorersHandler));
cricketAdminRouter.post("/matches/:id/start", scoreMatch, asyncHandler(startMatchHandler));
cricketAdminRouter.post("/matches/:id/scoring", scoreMatch, asyncHandler(claimScoringHandler));
cricketAdminRouter.delete("/matches/:id/scoring", scoreMatch, asyncHandler(releaseScoringHandler));
cricketAdminRouter.post("/matches/:id/scoring/hand-over", scoreMatch, asyncHandler(handOverScoringHandler));
cricketAdminRouter.put("/matches/:id/current", scoreMatch, holdSeat, asyncHandler(setCurrentPlayersHandler));
cricketAdminRouter.post("/matches/:id/balls", scoreMatch, holdSeat, asyncHandler(addBallHandler));
cricketAdminRouter.delete("/matches/:id/balls/last", scoreMatch, holdSeat, asyncHandler(undoBallHandler));
cricketAdminRouter.post("/matches/:id/end-innings", scoreMatch, holdSeat, asyncHandler(endInningsHandler));
cricketAdminRouter.post("/matches/:id/abandon", scoreMatch, holdSeat, asyncHandler(abandonMatchHandler));
// Corrections: an earlier ball, and a late arrival or substitute.
cricketAdminRouter.put("/matches/:id/balls/:innings/:ball", scoreMatch, holdSeat, asyncHandler(editBallHandler));
cricketAdminRouter.post("/matches/:id/squad", scoreMatch, holdSeat, asyncHandler(changeSquadHandler));
// Organisers: a result entered by hand, and taking a finished match back.
cricketAdminRouter.post("/matches/:id/result", organiseMatch, asyncHandler(declareResultHandler));
cricketAdminRouter.post("/matches/:id/reopen", organiseMatch, asyncHandler(reopenMatchHandler));
cricketAdminRouter.put("/matches/:id/player-of-match", scoreMatch, asyncHandler(setPlayerOfMatchHandler));
