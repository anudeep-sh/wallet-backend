/**
 * SLPE Payment Poller — DB-backed, server-restart safe, parallel.
 *
 * On startup:  queries w_payins & w_payouts for records that still need polling.
 * Every 30 s:  checks SLPE for status updates, processes completions/failures.
 *
 * Design choices:
 *   - No queue: PostgreSQL IS the queue (poll_until + last_polled_at columns).
 *   - Overlap guard: skips if the previous tick is still running.
 *   - 25 s debounce: won't re-poll a record polled less than 25 s ago.
 *   - Parallel: all SLPE HTTP calls fire concurrently (with configurable cap).
 */
import walletDb from "../../database/wallet-db";
import { slpe } from "./slpe.service";
import { processSuccessfulPayin } from "../payin/payin.service";
import { refundFailedPayout } from "../payout/payout.service";
import { PayinStatus } from "../payin/payin.types";
import { PayoutStatus } from "../../wallet-types";
import { logger } from "../../utils/logger";

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 25_000;
const MAX_CONCURRENCY = 10;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function startPolling(): void {
  logger.info("SLPE poller starting");
  pollOnce();
  timer = setInterval(() => {
    if (running) {
      logger.debug("Poller tick skipped — previous still running");
      return;
    }
    pollOnce();
  }, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  logger.info("SLPE poller stopped");
}

/* ------------------------------------------------------------------ */
/*  Concurrency-limited parallel runner                                */
/* ------------------------------------------------------------------ */

async function runParallel<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = MAX_CONCURRENCY,
): Promise<void> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    batches.push(items.slice(i, i + concurrency));
  }
  for (const batch of batches) {
    await Promise.allSettled(batch.map(fn));
  }
}

/* ------------------------------------------------------------------ */
/*  Single poll cycle                                                  */
/* ------------------------------------------------------------------ */

async function pollOnce(): Promise<void> {
  running = true;
  try {
    await Promise.allSettled([pollPayins(), pollPayouts()]);
    await expireStalePayins();
  } catch (err: any) {
    logger.error("Poll cycle error", { error: err.message });
  } finally {
    running = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Payin polling (parallel)                                           */
/* ------------------------------------------------------------------ */

async function pollPayins(): Promise<void> {
  const cutoff = new Date(Date.now() - DEBOUNCE_MS);

  const rows = await walletDb("w_payins")
    .where("status", PayinStatus.INITIATED)
    .whereNotNull("gateway_order_id")
    .where("poll_until", ">", new Date())
    .where(function () {
      this.whereNull("last_polled_at").orWhere("last_polled_at", "<", cutoff);
    })
    .select("*");

  if (rows.length === 0) return;
  logger.info("Polling payins", { count: rows.length });

  await runParallel(rows, async (payin) => {
    try {
      const res = await slpe.getOrderStatus(payin.gateway_order_id);

      await walletDb("w_payins")
        .where({ id: payin.id })
        .update({
          last_polled_at: new Date(),
          gateway_response: JSON.stringify(res),
          updated_at: walletDb.fn.now(),
        });

      const orderStatus = res?.data?.order_data?.status;

      if (orderStatus === "paid") {
        const txnId =
          res.data.order_data.transaction_id ||
          res.data.order_data.merchant_ref_id ||
          "";
        await processSuccessfulPayin(payin.id, txnId);
        logger.info("Payin succeeded (poll)", { payinId: payin.id });
      } else if (orderStatus === "failed" || orderStatus === "expired") {
        await walletDb("w_payins").where({ id: payin.id }).update({
          status: PayinStatus.FAILED,
          updated_at: walletDb.fn.now(),
        });
        logger.info("Payin failed (poll)", { payinId: payin.id, orderStatus });
      }
    } catch (err: any) {
      logger.error("Payin poll error", {
        payinId: payin.id,
        error: err.message,
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Payout polling (parallel)                                          */
/* ------------------------------------------------------------------ */

async function pollPayouts(): Promise<void> {
  const cutoff = new Date(Date.now() - DEBOUNCE_MS);

  const rows = await walletDb("w_payouts")
    .where("status", PayoutStatus.PROCESSING)
    .where("gateway", "slpe")
    .whereNotNull("gateway_txn_id")
    .where("poll_until", ">", new Date())
    .where(function () {
      this.whereNull("last_polled_at").orWhere("last_polled_at", "<", cutoff);
    })
    .select("*");

  if (rows.length === 0) return;
  logger.info("Polling payouts", { count: rows.length });

  await runParallel(rows, async (payout) => {
    try {
      const res = await slpe.getPayoutStatus(payout.gateway_txn_id);

      await walletDb("w_payouts")
        .where({ id: payout.id })
        .update({
          last_polled_at: new Date(),
          gateway_response: JSON.stringify(res),
          updated_at: walletDb.fn.now(),
        });

      const gwStatus = res?.data?.payout_data?.status;

      if (gwStatus === "processed" || gwStatus === "completed") {
        await walletDb("w_payouts").where({ id: payout.id }).update({
          status: PayoutStatus.COMPLETED,
          updated_at: walletDb.fn.now(),
        });
        logger.info("Payout completed (poll)", { payoutId: payout.id });
      } else if (gwStatus === "failed" || gwStatus === "reversed") {
        await refundFailedPayout(payout);
        logger.info("Payout failed, refunded (poll)", {
          payoutId: payout.id,
          gwStatus,
        });
      }
    } catch (err: any) {
      logger.error("Payout poll error", {
        payoutId: payout.id,
        error: err.message,
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Expire payins whose poll window has closed                         */
/* ------------------------------------------------------------------ */

async function expireStalePayins(): Promise<void> {
  const count = await walletDb("w_payins")
    .where("status", PayinStatus.INITIATED)
    .whereNotNull("poll_until")
    .where("poll_until", "<=", new Date())
    .update({
      status: PayinStatus.EXPIRED,
      updated_at: walletDb.fn.now(),
    });

  if (count > 0) {
    logger.info("Expired stale payins", { count });
  }
}
