import { Knex } from 'knex';

/**
 * Creates the `wallet` schema that houses all wallet-system tables.
 * Existing network tables in the `public` schema stay untouched.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS wallet');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP SCHEMA IF EXISTS wallet CASCADE');
}
