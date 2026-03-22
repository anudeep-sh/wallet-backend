import { Knex } from "knex";

/**
 * Split single wallet into dual wallets: 'main' (payin deposits) and 'commission' (referral earnings).
 *
 * 1. Add a `type` column to w_wallets.
 * 2. Drop the old unique(user_id) constraint, replace with unique(user_id, type).
 * 3. Backfill: insert a 'commission' wallet for every existing user that only has a 'main' wallet.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema("wallet").alterTable("w_wallets", (t) => {
    t.string("type", 20).notNullable().defaultTo("main");
  });

  await knex.raw(
    "ALTER TABLE wallet.w_wallets DROP CONSTRAINT IF EXISTS w_wallets_user_id_unique",
  );

  await knex.raw(
    "ALTER TABLE wallet.w_wallets ADD CONSTRAINT w_wallets_user_id_type_unique UNIQUE (user_id, type)",
  );

  await knex.raw(`
    INSERT INTO wallet.w_wallets (user_id, balance, type)
    SELECT user_id, 0, 'commission'
    FROM wallet.w_wallets
    WHERE type = 'main'
    AND user_id NOT IN (
      SELECT user_id FROM wallet.w_wallets WHERE type = 'commission'
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DELETE FROM wallet.w_wallets WHERE type = 'commission'");

  await knex.raw(
    "ALTER TABLE wallet.w_wallets DROP CONSTRAINT IF EXISTS w_wallets_user_id_type_unique",
  );

  await knex.raw(
    "ALTER TABLE wallet.w_wallets ADD CONSTRAINT w_wallets_user_id_unique UNIQUE (user_id)",
  );

  await knex.schema.withSchema("wallet").alterTable("w_wallets", (t) => {
    t.dropColumn("type");
  });
}
