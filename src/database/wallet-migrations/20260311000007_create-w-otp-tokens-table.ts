import { Knex } from 'knex';

/**
 * OTP tokens for login and MPIN-reset flows.
 * `otp` is stored as a bcrypt hash for security.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_otp_tokens', (t) => {
    t.increments('id').primary();
    t.string('identifier', 255).notNullable();   // email or phone number
    t.string('otp', 255).notNullable();           // bcrypt hash
    t.string('type', 10).notNullable();           // email | sms
    t.string('purpose', 20).notNullable();        // login | mpin_reset
    t.timestamp('expires_at').notNullable();
    t.boolean('is_used').notNullable().defaultTo(false);
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_otp_tokens');
}
