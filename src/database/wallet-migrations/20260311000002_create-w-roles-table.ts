import { Knex } from 'knex';

/**
 * The 9 fixed role levels.
 * `level` is the numeric hierarchy (1 = highest authority, 9 = lowest).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').createTable('w_roles', (t) => {
    t.increments('id').primary();
    t.string('name', 50).notNullable().unique();
    t.integer('level').notNullable().unique();
    t.string('description', 255).nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('wallet').dropTableIfExists('w_roles');
}
