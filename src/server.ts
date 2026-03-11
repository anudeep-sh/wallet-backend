import 'dotenv/config';
import Koa from "koa";
import Router from "koa-router";
import logger = require("koa-logger");
import bodyparser = require("koa-bodyparser");
import { NetworkController } from "./controllers/controller";
import {
  adminAuthenticate,
  authenticate,
  gibilauthenticate,
} from "./middleware/middleware";
import cors = require("@koa/cors");
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { FormsController } from "./controllers/Forms.controller";
import { AppError } from './lib/errors';

/* Wallet system route modules */
import { authRoutes } from './modules/auth/auth.routes';
import { usersRoutes } from './modules/users/users.routes';
import { walletRoutes } from './modules/wallet/wallet.routes';
import { payinRoutes } from './modules/payin/payin.routes';
import { payoutRoutes } from './modules/payout/payout.routes';
import { commissionRoutes } from './modules/commission/commission.routes';
import { adminRoutes } from './modules/admin/admin.routes';

const port = process.env.PORT || 8080;

const app = new Koa();
const router = new Router();

const register = new Registry();
collectDefaultMetrics({ register });

const httpRequestCounter = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

app.use(logger());
app.use(cors());
app.use(bodyparser());

/**
 * Global error handler — catches AppError subclasses thrown by wallet
 * services and returns a structured JSON response.
 */
app.use(async (ctx: any, next: any) => {
  try {
    await next();
  } catch (err: any) {
    if (err instanceof AppError) {
      ctx.status = err.statusCode;
      ctx.body = { error: err.message };
    } else {
      console.error('[unhandled]', err);
      ctx.status = err.status || 500;
      ctx.body = { error: err.message || 'Internal Server Error' };
    }
  }
});

/* Prometheus metrics middleware */
app.use(async (ctx: any, next: any) => {
  const start = Date.now();
  await next();
  const duration = (Date.now() - start) / 1000;
  httpRequestCounter
    .labels(ctx.method, ctx._matchedRoute || ctx.path, ctx.status.toString())
    .inc();
  httpRequestDuration
    .labels(ctx.method, ctx._matchedRoute || ctx.path, ctx.status.toString())
    .observe(duration);
});

router.get("/", async (ctx: any) => {
  ctx.body = {
    service: "wallet-system",
    version: "2.0.0",
    modules: ["network (legacy)", "wallet-auth", "wallet-users", "wallet", "payins", "payouts", "commissions", "admin"],
    health: "/health",
    metrics: "/metrics",
  };
});

const formsController = new FormsController();

const networkController = new NetworkController();

router.post("/register", networkController.registerController);
router.post("/login", networkController.loginController);
router.post("/gibil-login", networkController.gibilloginController);
router.patch(
  "/update-bank-details",
  authenticate,
  networkController.patchUserDetailsController
);

router.get("/wallet", authenticate, networkController.getWalletDetails);
router.get(
  "/wallet-history",
  authenticate,
  networkController.getWalletHistoryDetails
);
router.post("/add-hub", authenticate, networkController.addHUBController);
router.post("/network", authenticate, networkController.joinController);
router.get("/get-hub", authenticate, networkController.getLevelsController);
router.post(
  "/withdrawal",
  authenticate,
  networkController.withdrawalController
);
router.get("/withdrawal", authenticate, networkController.getWithdrawals);

// Admin routes
router.patch(
  "/update-withdrawal-request",
  adminAuthenticate,
  networkController.updateWithDrawalRequest
);
router.get(
  "/withdrawals-list/:status",
  authenticate,
  networkController.withdrawalList
);
router.patch(
  "/update-quota",
  authenticate,
  networkController.updateQuotaController
);
router.post(
  "/post-quota",
  adminAuthenticate,
  networkController.postQuotaController
);

router.get("/api/network", authenticate, networkController.networkController);
router.get("/get-quotas", authenticate, networkController.getQuotasController);
router.get(
  "/get-quota/:userId",
  authenticate,
  networkController.getQuotaByUserIdController
);
router.patch(
  "/users/:userId/password",
  authenticate,
  networkController.updatePasswordController
);
router.get(
  "/users/wallet-level",
  adminAuthenticate,
  networkController.getAllUsersWalletAndLevelController
);
router.get(
  "/v1/users-details-by-id",
  authenticate,
  networkController.userDetailsById
);

router.patch(
  "/v1/update-wallet-details",
  adminAuthenticate,
  networkController.updateWalletDetailsAsPerUserId
);

router.post(
  "/store-retailer-data",
  authenticate,
  networkController.storeRetailerDataAPI
);
router.post(
  "/premium-deduction-api",
  gibilauthenticate,
  networkController.premiumDeductionAPI
);
router.post(
  "/policy-confirmation-api",
  gibilauthenticate,
  networkController.policyConfirmationAPI
);

// Forms routes
router.get("/form/shortcode", formsController.getFormsByShortCode);
router.post("/forms", formsController.createForm);
router.get("/forms", formsController.getForms);
router.get("/forms/:id", formsController.getFormById);
router.put("/forms/:id", formsController.updateForm);
router.delete("/forms/:id", formsController.deleteForm);
// Form options routes
router.post("/form-options", formsController.createFormOptions);
router.get(
  "/form-options/:form_type",
  formsController.getFormOptions
);
router.put("/form-options/:id", formsController.updateFormOptions);

router.get("/health", async (ctx: any) => {
  ctx.body = { status: "ok", ts: new Date().toISOString() };
});

router.get("/metrics", async (ctx: any) => {
  ctx.set("Content-Type", register.contentType);
  ctx.body = await register.metrics();
});

/* Mount legacy network routes */
app.use(router.routes());

/* Mount all wallet-system routes */
app.use(authRoutes.routes()).use(authRoutes.allowedMethods());
app.use(usersRoutes.routes()).use(usersRoutes.allowedMethods());
app.use(walletRoutes.routes()).use(walletRoutes.allowedMethods());
app.use(payinRoutes.routes()).use(payinRoutes.allowedMethods());
app.use(payoutRoutes.routes()).use(payoutRoutes.allowedMethods());
app.use(commissionRoutes.routes()).use(commissionRoutes.allowedMethods());
app.use(adminRoutes.routes()).use(adminRoutes.allowedMethods());

app.listen(port);

console.log(`Wallet system server listening on port ${port}`);
