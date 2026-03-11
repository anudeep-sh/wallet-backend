import { Knex } from 'knex';

/**
 * Records every credit-card swipe / Razorpay payment initiated by a user.
 *
 * Lifecycle: initiated → processing → success | failed
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_payins', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');
    t.decimal('amount', 14, 2).notNullable();
    t.string('gateway', 30).notNullable().defaultTo('razorpay');
    t.string('gateway_order_id', 255).nullable();
    t.string('gateway_payment_id', 255).nullable();
    t.string('gateway_signature', 500).nullable();
    t.text('payin_url').nullable();
    t.decimal('total_commission', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_amount', 14, 2).notNullable().defaultTo(0);
    t.string('status', 20).notNullable().defaultTo('initiated');
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_payins');
}
