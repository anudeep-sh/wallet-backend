/**
 * Commission routes — mounted at /api/wallet/commissions
 */
import Router from 'koa-router';
import { walletAuth, adminOnly } from '../wallet-middleware';
import * as commissionService from './commission.service';

const router = new Router({ prefix: '/api/wallet/commissions' });

/** GET /config — list all default commission rates */
router.get('/config', walletAuth, async (ctx: any) => {
  ctx.body = await commissionService.getConfig();
  ctx.status = 200;
});

/** PUT /config — set default commission rates (admin only) */
router.put('/config', walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await commissionService.setConfig(ctx.state.walletUser.userId, ctx.request.body);
  ctx.status = 200;
});

/** GET /overrides — list overrides you've set */
router.get('/overrides', walletAuth, async (ctx: any) => {
  ctx.body = await commissionService.getOverrides(ctx.state.walletUser.userId);
  ctx.status = 200;
});

/** PUT /overrides/:userId — set/update override for a specific user */
router.put('/overrides/:userId', walletAuth, async (ctx: any) => {
  ctx.body = await commissionService.setOverride(
    ctx.state.walletUser.userId,
    ctx.params.userId,
    ctx.request.body,
  );
  ctx.status = 200;
});

/** DELETE /overrides/:userId — remove override */
router.delete('/overrides/:userId', walletAuth, async (ctx: any) => {
  const { beneficiaryUserId } = ctx.query;
  ctx.body = await commissionService.deleteOverride(
    ctx.state.walletUser.userId,
    ctx.params.userId,
    beneficiaryUserId as string,
  );
  ctx.status = 200;
});

/** GET /earnings — your commission earnings (paginated) */
router.get('/earnings', walletAuth, async (ctx: any) => {
  const page = parseInt(ctx.query.page || '1', 10);
  const limit = parseInt(ctx.query.limit || '50', 10);
  ctx.body = await commissionService.getEarnings(ctx.state.walletUser.userId, page, limit);
  ctx.status = 200;
});

export const commissionRoutes = router;
