import { Knex } from 'knex';

/**
 * Add polling columns to w_payins for the SLPE integration.
 *
 * - poll_until: timestamp until which the system should keep polling for status
 * - last_polled_at: last time we checked the gateway
 * - gateway_txn_id: SLPE's transaction reference
 * - gateway_response: raw JSON response from last status check
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').alterTable('w_payins', (t) => {
    t.timestamp('poll_until').nullable();
    t.timestamp('last_polled_at').nullable();
    t.string('gateway_txn_id', 255).nullable();
    t.jsonb('gateway_response').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').alterTable('w_payins', (t) => {
    t.dropColumn('poll_until');
    t.dropColumn('last_polled_at');
    t.dropColumn('gateway_txn_id');
    t.dropColumn('gateway_response');
  });
}
