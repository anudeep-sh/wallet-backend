/**
 * Wallet routes — mounted at /api/wallet/wallet
 */
import Router from 'koa-router';
import { walletAuth } from '../wallet-middleware';
import * as walletService from './wallet.service';

const router = new Router({ prefix: '/api/wallet/wallet' });

/** GET / — own wallet balance */
router.get('/', walletAuth, async (ctx: any) => {
  ctx.body = await walletService.getBalance(ctx.state.walletUser.userId);
  ctx.status = 200;
});

/** GET /transactions — transaction history (paginated, filterable) */
router.get('/transactions', walletAuth, async (ctx: any) => {
  ctx.body = await walletService.getTransactions(ctx.state.walletUser.userId, ctx.query);
  ctx.status = 200;
});

/** GET /summary — balance + today's totals */
router.get('/summary', walletAuth, async (ctx: any) => {
  ctx.body = await walletService.getSummary(ctx.state.walletUser.userId);
  ctx.status = 200;
});

export const walletRoutes = router;
