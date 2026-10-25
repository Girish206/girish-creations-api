import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { upload } from "../../middleware/upload";
import { requireAdminAuth, requireCricketAccess, requireSuperAdmin } from "../../middleware/auth";
import { parseId } from "../../utils/parseId";
import { assertCanManageTournament, assertMatchAccess, type MatchAccess } from "./cricket.service";
import { assertScoringSeat } from "./cricket-match.service";
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
  playerCareerHandler,
  revokePlayerLoginHandler,
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
  getSavedTeamHandler,
  setSavedTeamRolesHandler,
  updateSavedTeamHandler,
} from "./cricket-team.controller";

// Public sign-in lookup and sign-up for players (mounted outside the
// signed-in router).
export const cricketPublicRouter = Router();
cricketPublicRouter.post("/sign-in/lookup", asyncHandler(signInLookupHandler));
cricketPublicRouter.post("/register", asyncHandler(signUpHandler));

// Players with cricket access read their own stats, matches and
// tournaments (the handlers check which). Anyone can create a tournament or
// match and then manage it (manageTournament / manageMatch), adding players
// to their squads (POST /players); editing players and the rest is super admin.
export const cricketAdminRouter = Router();
cricketAdminRouter.use(requireAdminAuth, requireCricketAccess);
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
// Only the one holding the scoring seat changes a live match's score.
const holdSeat = asyncHandler(async (req, _res, next) => {
  await assertScoringSeat(parseId(req.params.id), scorerOf(req));
  next();
});

cricketAdminRouter.get("/me", asyncHandler(meHandler));
cricketAdminRouter.put("/me/profile", asyncHandler(updateMyProfileHandler));
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
cricketAdminRouter.get("/tournaments/:id/teams/:index/lookup", asyncHandler(lookupTeamPlayerHandler));
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

// A one-off match's captain, found by mobile before adding them.
cricketAdminRouter.get("/players/lookup", asyncHandler(lookupPlayerHandler));
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
cricketAdminRouter.put("/matches/:id/player-of-match", scoreMatch, asyncHandler(setPlayerOfMatchHandler));
