import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { upload } from "../../middleware/upload";
import { requireAdminAuth, requireCricketAccess, requireSuperAdmin } from "../../middleware/auth";
import {
  addTeamsHandler,
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
  updateTournamentHandler,
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

// Public sign-up for players (mounted outside the signed-in router).
export const cricketPublicRouter = Router();
cricketPublicRouter.post("/register", asyncHandler(signUpHandler));

// Players with cricket access read their own stats, matches and
// tournaments (the handlers check which); everything else is super admin.
export const cricketAdminRouter = Router();
cricketAdminRouter.use(requireAdminAuth, requireCricketAccess);
const admin = requireSuperAdmin;

cricketAdminRouter.get("/me", asyncHandler(meHandler));
cricketAdminRouter.put("/me/profile", asyncHandler(updateMyProfileHandler));
cricketAdminRouter.put("/me/photo", upload.fields([{ name: "photo", maxCount: 1 }]), asyncHandler(setMyPhotoHandler));
cricketAdminRouter.get("/players", asyncHandler(listPlayersHandler));
cricketAdminRouter.get("/tournaments/:id", asyncHandler(getTournamentHandler));
cricketAdminRouter.get("/matches", asyncHandler(listMatchesHandler));
cricketAdminRouter.get("/matches/:id", asyncHandler(getMatchHandler));

cricketAdminRouter.post("/players", admin, asyncHandler(createPlayerHandler));
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

cricketAdminRouter.get("/tournaments", admin, asyncHandler(listTournamentsHandler));
cricketAdminRouter.post("/tournaments", admin, asyncHandler(createTournamentHandler));
cricketAdminRouter.put("/tournaments/:id", admin, asyncHandler(updateTournamentHandler));
cricketAdminRouter.delete("/tournaments/:id", admin, asyncHandler(deleteTournamentHandler));
cricketAdminRouter.put(
  "/tournaments/:id/images",
  admin,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "banner", maxCount: 1 },
  ]),
  asyncHandler(setTournamentImagesHandler),
);
cricketAdminRouter.put("/tournaments/:id/players", admin, asyncHandler(setSquadHandler));
cricketAdminRouter.put("/tournaments/:id/match-sets", admin, asyncHandler(setMatchSetsHandler));
cricketAdminRouter.post("/tournaments/:id/generate", admin, asyncHandler(generateTeamsHandler));
cricketAdminRouter.post("/tournaments/:id/swap", admin, asyncHandler(swapPlayersHandler));
cricketAdminRouter.post("/tournaments/:id/move", admin, asyncHandler(movePlayerHandler));
cricketAdminRouter.post("/tournaments/:id/teams", admin, asyncHandler(addTeamsHandler));
cricketAdminRouter.put("/tournaments/:id/teams/:index", admin, asyncHandler(updateTeamHandler));
cricketAdminRouter.delete("/tournaments/:id/teams/:index", admin, asyncHandler(removeTeamHandler));

cricketAdminRouter.post("/matches", admin, asyncHandler(createMatchHandler));
cricketAdminRouter.put("/matches/:id", admin, asyncHandler(updateMatchHandler));
cricketAdminRouter.delete("/matches/:id", admin, asyncHandler(deleteMatchHandler));
cricketAdminRouter.post("/matches/:id/start", admin, asyncHandler(startMatchHandler));
cricketAdminRouter.put("/matches/:id/current", admin, asyncHandler(setCurrentPlayersHandler));
cricketAdminRouter.post("/matches/:id/balls", admin, asyncHandler(addBallHandler));
cricketAdminRouter.delete("/matches/:id/balls/last", admin, asyncHandler(undoBallHandler));
cricketAdminRouter.post("/matches/:id/end-innings", admin, asyncHandler(endInningsHandler));
cricketAdminRouter.post("/matches/:id/abandon", admin, asyncHandler(abandonMatchHandler));
cricketAdminRouter.put("/matches/:id/player-of-match", admin, asyncHandler(setPlayerOfMatchHandler));
