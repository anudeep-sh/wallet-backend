/**
 * Auth routes — mounted at /api/wallet/auth
 */
import Router from 'koa-router';
import { walletAuth } from '../wallet-middleware';
import * as authService from './auth.service';
import type { RequestOtpBody, VerifyOtpBody, VerifyMpinBody, RefreshTokenBody } from './auth.types';

const router = new Router({ prefix: '/api/wallet/auth' });

/**
 * POST /api/wallet/auth/request-otp
 * Body: { identifier, channel? }
 */
router.post('/request-otp', async (ctx: any) => {
  const { identifier, channel } = ctx.request.body as RequestOtpBody;
  if (!identifier) { ctx.status = 400; ctx.body = { error: 'identifier is required' }; return; }
  ctx.body = await authService.requestOtp(identifier.trim(), channel);
  ctx.status = 200;
});

/**
 * POST /api/wallet/auth/verify-otp
 * Body: { identifier, otp }
 */
router.post('/verify-otp', async (ctx: any) => {
  const { identifier, otp } = ctx.request.body as VerifyOtpBody;
  if (!identifier || !otp) { ctx.status = 400; ctx.body = { error: 'identifier and otp are required' }; return; }
  ctx.body = await authService.verifyOtp(identifier.trim(), otp.trim());
  ctx.status = 200;
});

/**
 * POST /api/wallet/auth/verify-mpin
 * Headers: Authorization Bearer <token>
 * Body: { mpin }
 */
router.post('/verify-mpin', walletAuth, async (ctx: any) => {
  const { mpin } = ctx.request.body as VerifyMpinBody;
  if (!mpin) { ctx.status = 400; ctx.body = { error: 'mpin is required' }; return; }
  ctx.body = await authService.verifyMpin(ctx.state.walletUser.userId, mpin);
  ctx.status = 200;
});

/**
 * POST /api/wallet/auth/refresh-token
 * Body: { refreshToken }
 */
router.post('/refresh-token', async (ctx: any) => {
  const { refreshToken } = ctx.request.body as RefreshTokenBody;
  if (!refreshToken) { ctx.status = 400; ctx.body = { error: 'refreshToken is required' }; return; }
  ctx.body = await authService.refreshAccessToken(refreshToken);
  ctx.status = 200;
});

/**
 * POST /api/wallet/auth/logout
 * Headers: Authorization Bearer <token>
 */
router.post('/logout', walletAuth, async (ctx: any) => {
  ctx.body = await authService.logout(ctx.state.walletUser.userId);
  ctx.status = 200;
});

export const authRoutes = router;
