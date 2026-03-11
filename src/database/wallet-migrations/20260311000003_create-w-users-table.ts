import { Knex } from 'knex';

/**
 * Core user table for the wallet system.
 *
 * - `parent_id` self-references the user who invited this one.
 * - `role_id` links to w_roles.
 * - `mpin` / `password` are stored as bcrypt hashes.
 * - `file_urls` stores an array of document URLs (KYC docs, etc.).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('email', 255).notNullable().unique();
    t.string('mobile_number', 20).notNullable().unique();
    t.string('gender', 10).nullable();
    t.date('date_of_birth').nullable();
    t.string('address_1', 500).nullable();
    t.string('address_2', 500).nullable();
    t.string('city', 100).nullable();
    t.string('state', 100).nullable();
    t.string('pincode', 10).nullable();
    t.string('pan_card_number', 20).nullable();
    t.string('aadhar_card_number', 20).nullable();
    t.string('name_on_aadhar', 200).nullable();
    t.string('bank_account_number', 30).nullable();
    t.string('ifsc_code', 20).nullable();

    t.integer('role_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('wallet.w_roles');

    t.uuid('parent_id').nullable().references('id').inTable('wallet.w_users');

    t.string('mpin', 255).nullable();
    t.string('password', 255).nullable();

    t.decimal('deposit_limit', 14, 2).notNullable().defaultTo(0);
    t.decimal('withdraw_daily_limit', 14, 2).notNullable().defaultTo(0);

    t.jsonb('file_urls').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_verified').notNullable().defaultTo(false);

    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_users');
}
