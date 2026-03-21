/**
 * Payin routes — mounted at /api/wallet/payins
 */
import Router from "koa-router";
import { walletAuth } from "../wallet-middleware";
import * as payinService from "./payin.service";

const router = new Router({ prefix: "/api/wallet/payins" });

/** POST /initiate — create an SLPE order and get the payment URL */
router.post("/initiate", walletAuth, async (ctx: any) => {
  ctx.body = await payinService.initiatePayin(
    ctx.state.walletUser.userId,
    ctx.request.body,
  );
  ctx.status = 201;
});

/**
 * POST /slpe-webhook — SLPE server-to-server callback.
 * No auth — this is called directly by SLPE.
 */
router.post("/slpe-webhook", async (ctx: any) => {
  ctx.body = await payinService.handleSlpeWebhook(ctx.request.body);
  ctx.status = 200;
});

/** GET /:id/status — lightweight status check for frontend polling */
router.get("/:id/status", walletAuth, async (ctx: any) => {
  ctx.body = await payinService.checkPayinStatus(
    ctx.state.walletUser.userId,
    ctx.params.id,
  );
  ctx.status = 200;
});

/** GET / — list own payins */
router.get("/", walletAuth, async (ctx: any) => {
  const page = parseInt(ctx.query.page || "1", 10);
  const limit = parseInt(ctx.query.limit || "20", 10);
  ctx.body = await payinService.listPayins(
    ctx.state.walletUser.userId,
    page,
    limit,
  );
  ctx.status = 200;
});

/** GET /:id — payin details with commission breakdown */
router.get("/:id", walletAuth, async (ctx: any) => {
  ctx.body = await payinService.getPayinDetails(
    ctx.state.walletUser.userId,
    ctx.params.id,
  );
  ctx.status = 200;
});

export const payinRoutes = router;
