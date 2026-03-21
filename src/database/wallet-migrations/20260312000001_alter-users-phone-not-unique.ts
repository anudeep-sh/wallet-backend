import { Knex } from 'knex';

/**
 * Allow multiple users to share the same phone number.
 * Email remains the unique identifier per wallet/user.
 *
 * Use case: one person acts in multiple roles (e.g. SUPER_DISTRIBUTOR + RETAILER)
 * using different email addresses but the same phone.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE wallet.w_users DROP CONSTRAINT IF EXISTS w_users_mobile_number_unique');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_w_users_mobile_number ON wallet.w_users (mobile_number)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS wallet.idx_w_users_mobile_number');
  await knex.raw('ALTER TABLE wallet.w_users ADD CONSTRAINT w_users_mobile_number_unique UNIQUE (mobile_number)');
}
