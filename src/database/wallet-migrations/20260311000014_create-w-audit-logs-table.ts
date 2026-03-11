import { Knex } from 'knex';

/**
 * Audit trail for important actions (invites, payouts, config changes, etc.)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_audit_logs', (t) => {
    t.increments('id').primary();
    t.uuid('user_id').nullable().references('id').inTable('wallet.w_users');
    t.string('action', 100).notNullable();
    t.string('entity_type', 50).nullable();
    t.string('entity_id', 255).nullable();
    t.jsonb('meta').nullable();
    t.string('ip_address', 50).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_audit_logs');
}
