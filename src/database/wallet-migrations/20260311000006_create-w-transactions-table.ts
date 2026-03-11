import { Knex } from 'knex';

/**
 * Immutable ledger of every wallet movement (credits & debits).
 * `balance_before` / `balance_after` provide a running audit trail.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    t.uuid('wallet_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_wallets');

    t.uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');

    t.string('type', 10).notNullable();          // credit | debit
    t.decimal('amount', 14, 2).notNullable();
    t.decimal('balance_before', 14, 2).notNullable();
    t.decimal('balance_after', 14, 2).notNullable();
    t.string('description', 500).nullable();
    t.string('reference_id', 255).nullable();
    t.string('reference_type', 30).notNullable(); // payin | payout | commission | adjustment
    t.string('status', 20).notNullable().defaultTo('success');

    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_transactions');
}
