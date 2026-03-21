import { Knex } from 'knex';

/**
 * Add SLPE gateway columns to w_payouts for payout processing and polling.
 *
 * - gateway: which PG (slpe)
 * - gateway_txn_id: SLPE's payout reference
 * - gateway_response: raw JSON from last status check
 * - poll_until / last_polled_at: for status polling
 * - bank_validated: whether we validated the bank account before payout
 * - bank_validation_response: raw response from account validation
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').alterTable('w_payouts', (t) => {
    t.string('gateway', 30).nullable().defaultTo('slpe');
    t.string('gateway_txn_id', 255).nullable();
    t.jsonb('gateway_response').nullable();
    t.timestamp('poll_until').nullable();
    t.timestamp('last_polled_at').nullable();
    t.boolean('bank_validated').notNullable().defaultTo(false);
    t.jsonb('bank_validation_response').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').alterTable('w_payouts', (t) => {
    t.dropColumn('gateway');
    t.dropColumn('gateway_txn_id');
    t.dropColumn('gateway_response');
    t.dropColumn('poll_until');
    t.dropColumn('last_polled_at');
    t.dropColumn('bank_validated');
    t.dropColumn('bank_validation_response');
  });
}
