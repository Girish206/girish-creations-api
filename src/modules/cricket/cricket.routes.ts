import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { upload } from "../../middleware/upload";
import { requireAdminAuth, requireCricketAccess, requireSuperAdmin } from "../../middleware/auth";
import { parseId } from "../../utils/parseId";
import { assertCanManageMatch, assertCanManageTournament } from "./cricket.service";
import {
  addTeamPlayersHandler,
  addFriendlyTeamPlayersHandler,
  addTeamsHandler,
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
  revokePlayerLoginHandler,
  setMyPhotoHandler,
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
  updateTournamentHandler,
  viewerOf,
} from "./cricket.controller";
import {
  abandonMatchHandler,
  addBallHandler,
  createMatchHandler,
  deleteMatchHandler,
  endInningsHandler,
  getMatchHandler,
  listMatchesHandler,
  setCurrentPlayersHandler,
  setPlayerOfMatchHandler,
  startMatchHandler,
  undoBallHandler,
  updateMatchHandler,
} from "./cricket-match.controller";
import { followCountsHandler, followHandler, listMyFollowsHandler, unfollowHandler } from "./cricket-follow.controller";

// Public sign-up for players (mounted outside the signed-in router).
export const cricketPublicRouter = Router();
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
const manageMatch = asyncHandler(async (req, _res, next) => {
  await assertCanManageMatch(parseId(req.params.id), viewerOf(req));
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
// A team's captain adds players to it (the service checks who's asking).
cricketAdminRouter.get("/tournaments/:id/teams/:index/lookup", asyncHandler(lookupTeamPlayerHandler));
cricketAdminRouter.post("/tournaments/:id/teams/:index/players", asyncHandler(addTeamPlayersHandler));
// A friendly team's captain adds players to its upcoming matches.
cricketAdminRouter.post("/friendly-teams/players", asyncHandler(addFriendlyTeamPlayersHandler));

// A one-off match's captain, found by mobile before adding them.
cricketAdminRouter.get("/players/lookup", asyncHandler(lookupPlayerHandler));
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

cricketAdminRouter.post("/matches", asyncHandler(createMatchHandler));
cricketAdminRouter.put("/matches/:id", manageMatch, asyncHandler(updateMatchHandler));
cricketAdminRouter.delete("/matches/:id", manageMatch, asyncHandler(deleteMatchHandler));
cricketAdminRouter.post("/matches/:id/start", manageMatch, asyncHandler(startMatchHandler));
cricketAdminRouter.put("/matches/:id/current", manageMatch, asyncHandler(setCurrentPlayersHandler));
cricketAdminRouter.post("/matches/:id/balls", manageMatch, asyncHandler(addBallHandler));
cricketAdminRouter.delete("/matches/:id/balls/last", manageMatch, asyncHandler(undoBallHandler));
cricketAdminRouter.post("/matches/:id/end-innings", manageMatch, asyncHandler(endInningsHandler));
cricketAdminRouter.post("/matches/:id/abandon", manageMatch, asyncHandler(abandonMatchHandler));
cricketAdminRouter.put("/matches/:id/player-of-match", manageMatch, asyncHandler(setPlayerOfMatchHandler));
