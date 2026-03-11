import { Knex } from 'knex';

/**
 * Per-user commission overrides.
 *
 * A parent can set a custom commission % for a specific child that
 * supersedes the default in w_commission_configs.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_user_commission_overrides', (t) => {
    t.increments('id').primary();
    t.uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');
    t.uuid('beneficiary_user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');
    t.decimal('percentage', 6, 3).notNullable();
    t.uuid('set_by').nullable().references('id').inTable('wallet.w_users');
    t.timestamps(true, true);

    t.unique(['user_id', 'beneficiary_user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_user_commission_overrides');
}
