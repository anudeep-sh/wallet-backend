import { Knex } from 'knex';

/**
 * Withdrawal (payout) requests.
 * Lifecycle: pending → approved → processing → completed | rejected
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_payouts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');
    t.decimal('amount', 14, 2).notNullable();
    t.string('bank_account_number', 30).nullable();
    t.string('ifsc_code', 20).nullable();
    t.string('account_holder_name', 200).nullable();
    t.string('status', 20).notNullable().defaultTo('pending');
    t.uuid('approved_by').nullable().references('id').inTable('wallet.w_users');
    t.text('rejection_reason').nullable();
    t.string('reference_id', 255).nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_payouts');
}
