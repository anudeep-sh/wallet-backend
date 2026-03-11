import { Knex } from 'knex';

/**
 * Default commission rates keyed by level pair.
 *
 * When a user at `transaction_role_level` does a payin, every ancestor
 * whose role matches `beneficiary_role_level` earns `percentage` of the
 * transaction amount.  These are the system-wide defaults set by ADMIN.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_commission_configs', (t) => {
    t.increments('id').primary();
    t.integer('transaction_role_level').notNullable();
    t.integer('beneficiary_role_level').notNullable();
    t.decimal('percentage', 6, 3).notNullable();
    t.uuid('set_by').nullable().references('id').inTable('wallet.w_users');
    t.timestamps(true, true);

    t.unique(['transaction_role_level', 'beneficiary_role_level']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_commission_configs');
}
