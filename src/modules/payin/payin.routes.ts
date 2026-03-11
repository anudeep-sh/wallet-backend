/**
 * Payin routes — mounted at /api/wallet/payins
 */
import Router from 'koa-router';
import { walletAuth } from '../wallet-middleware';
import * as payinService from './payin.service';

const router = new Router({ prefix: '/api/wallet/payins' });

/** POST /initiate — create a Razorpay order and get the pay URL */
router.post('/initiate', walletAuth, async (ctx: any) => {
  ctx.body = await payinService.initiatePayin(ctx.state.walletUser.userId, ctx.request.body);
  ctx.status = 201;
});

/** POST /verify — client-side callback after Razorpay checkout */
router.post('/verify', walletAuth, async (ctx: any) => {
  ctx.body = await payinService.verifyPayin(ctx.request.body);
  ctx.status = 200;
});

/**
 * POST /webhook — Razorpay server-to-server webhook.
 * No auth header — verification is via HMAC signature in x-razorpay-signature.
 */
router.post('/webhook', async (ctx: any) => {
  const signature = ctx.headers['x-razorpay-signature'] || '';
  const rawBody = JSON.stringify(ctx.request.body);
  ctx.body = await payinService.handleWebhook(rawBody, signature);
  ctx.status = 200;
});

/** GET / — list own payins */
router.get('/', walletAuth, async (ctx: any) => {
  const page = parseInt(ctx.query.page || '1', 10);
  const limit = parseInt(ctx.query.limit || '20', 10);
  ctx.body = await payinService.listPayins(ctx.state.walletUser.userId, page, limit);
  ctx.status = 200;
});

/** GET /:id — payin details with commission breakdown */
router.get('/:id', walletAuth, async (ctx: any) => {
  ctx.body = await payinService.getPayinDetails(ctx.state.walletUser.userId, ctx.params.id);
  ctx.status = 200;
});

export const payinRoutes = router;
