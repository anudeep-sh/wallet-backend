/**
 * Admin routes — mounted at /api/wallet/admin
 * All routes require ADMIN role (level 1).
 */
import Router from 'koa-router';
import { walletAuth, adminOnly } from '../wallet-middleware';
import * as adminService from './admin.service';

const router = new Router({ prefix: '/api/wallet/admin' });

/** GET /dashboard — system-wide stats */
router.get('/dashboard', walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await adminService.getDashboard();
  ctx.status = 200;
});

/** GET /users — list all wallet users with filters */
router.get('/users', walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await adminService.listUsers(ctx.query);
  ctx.status = 200;
});

/** GET /transactions — all transactions system-wide */
router.get('/transactions', walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await adminService.listTransactions(ctx.query);
  ctx.status = 200;
});

/** GET /payins — all payins system-wide */
router.get('/payins', walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await adminService.listPayins(ctx.query);
  ctx.status = 200;
});

/** GET /payouts — all payouts (with approval queue via ?status=pending) */
router.get('/payouts', walletAuth, adminOnly, async (ctx: any) => {
  ctx.body = await adminService.listPayouts(ctx.query);
  ctx.status = 200;
});

export const adminRoutes = router;
