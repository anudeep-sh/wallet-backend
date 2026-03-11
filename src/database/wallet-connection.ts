/**
 * Knex CLI configuration for wallet-schema migrations.
 *
 * Usage:
 *   npx knex --knexfile src/database/wallet-connection.ts migrate:latest
 *   npm run knex:wallet migrate:latest
 */
import { Knex } from 'knex';

const walletKnexConfig: Knex.Config = {
  client: 'pg',
  connection: {
    host: '34.170.105.45',
    user: 'networks',
    password: '??9Eit-^8e4}J*>7',
    database: 'networks',
    port: 5432,
  },
  searchPath: ['wallet', 'public'],
  pool: { min: 2, max: 10 },
  migrations: {
    directory: __dirname + '/wallet-migrations',
    extension: 'ts',
    schemaName: 'wallet',
  },
  seeds: {
    directory: __dirname + '/seeds',
    extension: 'ts',
  },
};

export default walletKnexConfig;
