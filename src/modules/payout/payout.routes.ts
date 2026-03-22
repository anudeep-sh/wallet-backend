/**
 * Payout routes — mounted at /api/wallet/payouts
 */
import Router from "koa-router";
import { walletAuth, adminOnly } from "../wallet-middleware";
import * as payoutService from "./payout.service";

const router = new Router({ prefix: "/api/wallet/payouts" });

/** POST /request — submit a withdrawal (body.walletType = 'main' | 'commission') */
router.post("/request", walletAuth, async (ctx: any) => {
  ctx.body = await payoutService.requestPayout(
    ctx.state.walletUser.userId,
    ctx.request.body,
  );
  ctx.status = 201;
});

/**
 * POST /slpe-webhook — SLPE server-to-server callback for payouts.
 * No auth — called directly by SLPE.
 */
router.post("/slpe-webhook", async (ctx: any) => {
  ctx.body = await payoutService.handleSlpePayoutWebhook(ctx.request.body);
  ctx.status = 200;
});

/** GET / — list own payouts */
router.get("/", walletAuth, async (ctx: any) => {
  const page = parseInt(ctx.query.page || "1", 10);
  const limit = parseInt(ctx.query.limit || "20", 10);
  ctx.body = await payoutService.listPayouts(
    ctx.state.walletUser.userId,
    page,
    limit,
  );
  ctx.status = 200;
});

/** GET /:id — payout details */
router.get("/:id", walletAuth, async (ctx: any) => {
  ctx.body = await payoutService.getPayoutDetails(
    ctx.state.walletUser.userId,
    ctx.params.id,
  );
  ctx.status = 200;
});

/** PUT /:id/approve — admin-only: approve commission payout and trigger SLPE */
router.put("/:id/approve", walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await payoutService.approvePayout(
    ctx.state.walletUser.userId,
    ctx.params.id,
  );
  ctx.status = 200;
});

/** PUT /:id/reject — admin-only: reject commission payout and refund */
router.put("/:id/reject", walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await payoutService.rejectPayout(
    ctx.state.walletUser.userId,
    ctx.params.id,
    ctx.request.body,
  );
  ctx.status = 200;
});

export const payoutRoutes = router;
