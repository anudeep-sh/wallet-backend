/**
 * Users routes — mounted at /api/wallet/users
 */
import Router from "koa-router";
import { walletAuth } from "../wallet-middleware";
import * as usersService from "./users.service";

const router = new Router({ prefix: "/api/wallet/users" });

/** POST /invite — send an invitation to onboard a new user */
router.post("/invite", walletAuth, async (ctx: any) => {
  const { walletUser } = ctx.state;
  ctx.body = await usersService.inviteUser(walletUser.userId, ctx.request.body);
  ctx.status = 201;
});

/** GET /invite/:token — get pre-filled invite details for registration form */
router.get("/invite/:token", async (ctx: any) => {
  ctx.body = await usersService.getInviteDetails(ctx.params.token);
  ctx.status = 200;
});

/** POST /register — accept invite, set password & MPIN, create account */
router.post("/register", async (ctx: any) => {
  ctx.body = await usersService.registerUser(ctx.request.body);
  ctx.status = 201;
});

/** GET /me — own profile */
router.get("/me", walletAuth, async (ctx: any) => {
  ctx.body = await usersService.getProfile(ctx.state.walletUser.userId);
  ctx.status = 200;
});

/** PUT /me — update own profile */
router.put("/me", walletAuth, async (ctx: any) => {
  ctx.body = await usersService.updateProfile(
    ctx.state.walletUser.userId,
    ctx.request.body,
  );
  ctx.status = 200;
});

/** PUT /me/mpin — set or change MPIN */
router.put("/me/mpin", walletAuth, async (ctx: any) => {
  ctx.body = await usersService.changeMpin(
    ctx.state.walletUser.userId,
    ctx.request.body,
  );
  ctx.status = 200;
});

/** GET /downline — list all users under you */
router.get("/downline", walletAuth, async (ctx: any) => {
  const page = parseInt(ctx.query.page || "1", 10);
  const limit = parseInt(ctx.query.limit || "50", 10);
  const roleFilter = ctx.query.roleId
    ? parseInt(ctx.query.roleId, 10)
    : undefined;
  ctx.body = await usersService.getDownline(
    ctx.state.walletUser.userId,
    page,
    limit,
    roleFilter,
  );
  ctx.status = 200;
});

/** GET /invites-sent — list invitations sent by the current user */
router.get("/invites-sent", walletAuth, async (ctx: any) => {
  const page = parseInt(ctx.query.page || "1", 10);
  const limit = parseInt(ctx.query.limit || "50", 10);
  ctx.body = await usersService.getInvitesSent(
    ctx.state.walletUser.userId,
    page,
    limit,
  );
  ctx.status = 200;
});

/** GET /downline/tree — downline as nested tree for org chart */
router.get("/downline/tree", walletAuth, async (ctx: any) => {
  ctx.body = await usersService.getDownlineTree(ctx.state.walletUser.userId);
  ctx.status = 200;
});

/** GET /:id — get a specific user in your downline */
router.get("/:id", walletAuth, async (ctx: any) => {
  ctx.body = await usersService.getDownlineUser(
    ctx.state.walletUser.userId,
    ctx.params.id,
  );
  ctx.status = 200;
});

/** PUT /:id/status — activate or deactivate a downline user */
router.put("/:id/status", walletAuth, async (ctx: any) => {
  const { isActive } = ctx.request.body;
  ctx.body = await usersService.toggleUserStatus(
    ctx.state.walletUser.userId,
    ctx.params.id,
    isActive,
  );
  ctx.status = 200;
});

/** PUT /:id/limits — update deposit / withdraw limits for a downline user */
router.put("/:id/limits", walletAuth, async (ctx: any) => {
  ctx.body = await usersService.updateLimits(
    ctx.state.walletUser.userId,
    ctx.params.id,
    ctx.request.body,
  );
  ctx.status = 200;
});

export const usersRoutes = router;
