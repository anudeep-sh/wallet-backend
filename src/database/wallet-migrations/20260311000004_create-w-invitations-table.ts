import { Knex } from 'knex';

/**
 * Invitation records created when a parent invites a new user.
 *
 * All onboarding data is captured at invite time so the invitee only
 * needs to set their MPIN & password to complete registration.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_invitations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    t.uuid('invited_by')
      .notNullable()
      .references('id')
      .inTable('wallet.w_users');

    t.integer('role_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('wallet.w_roles');

    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('email', 255).notNullable();
    t.string('mobile_number', 20).notNullable();
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
    t.decimal('deposit_limit', 14, 2).notNullable().defaultTo(0);
    t.decimal('withdraw_daily_limit', 14, 2).notNullable().defaultTo(0);
    t.jsonb('file_urls').nullable();

    t.string('token', 255).notNullable().unique();
    t.string('status', 20).notNullable().defaultTo('pending');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_invitations');
}
