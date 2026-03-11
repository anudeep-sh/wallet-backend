import { Knex } from 'knex';

/**
 * Immutable record of each commission credited for a payin.
 * One row per ancestor who received a cut.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_commission_ledger', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payin_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_payins');
    t.uuid('from_user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');
    t.uuid('to_user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');
    t.decimal('amount', 14, 2).notNullable();
    t.decimal('percentage', 6, 3).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_commission_ledger');
}
