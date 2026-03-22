import { Knex } from "knex";

/**
 * Track which wallet a payout draws from: 'main' (instant) or 'commission' (approval required).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema("wallet").alterTable("w_payouts", (t) => {
    t.string("wallet_type", 20).notNullable().defaultTo("commission");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema("wallet").alterTable("w_payouts", (t) => {
    t.dropColumn("wallet_type");
  });
}
