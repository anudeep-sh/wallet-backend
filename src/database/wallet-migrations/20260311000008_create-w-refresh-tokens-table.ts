import { Knex } from 'knex';

/**
 * Refresh tokens for session management.
 * Stored as bcrypt hashes so a DB leak doesn't compromise active sessions.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_refresh_tokens', (t) => {
    t.increments('id').primary();
    t.uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');
    t.string('token', 255).notNullable();         // bcrypt hash of raw token
    t.timestamp('expires_at').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_refresh_tokens');
}
