import { Knex } from 'knex';

/**
 * One wallet per user — stores the current balance.
 * Created automatically when a user completes registration.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_wallets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('wallet.w_users');
    t.decimal('balance', 14, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_wallets');
}
