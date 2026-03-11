/**
 * Knex instance scoped to the `wallet` schema.
 *
 * Connects to the same PostgreSQL database used by the existing network
 * backend but sets `searchPath` to "wallet" so every unqualified table
 * reference resolves to the wallet schema.  The `public` schema is
 * included as a fallback for shared resources like extensions.
 */
import knex from 'knex';

const walletDb = knex({
  client: 'pg',
  connection: {
    host: '34.170.105.45',
    user: 'networks',
    password: '??9Eit-^8e4}J*>7',
    database: 'networks',
    port: 5432,
  },
  searchPath: ['wallet', 'public'],
  pool: { min: 2, max: 20, propagateCreateError: false },
  debug: process.env.NODE_ENV !== 'production',
});

export default walletDb;
