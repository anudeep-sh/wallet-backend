import { Knex } from 'knex';
import * as bcrypt from 'bcrypt';

/**
 * Seeds the wallet schema with:
 *   1. The 9 fixed roles
 *   2. A root ADMIN user (the top of the hierarchy)
 *   3. A wallet for the ADMIN user
 *   4. Default commission config for common level pairs
 */
export async function seed(knex: Knex): Promise<void> {
  /* ---- 1. Roles ---- */
  const roles = [
    { id: 1, name: 'ADMIN',              level: 1, description: 'System administrator — top of the chain' },
    { id: 2, name: 'ADMIN_PARTNER',      level: 2, description: 'Admin partner' },
    { id: 3, name: 'WHITE_LABEL',        level: 3, description: 'White-label reseller' },
    { id: 4, name: 'STATE_HEAD',         level: 4, description: 'State-level head' },
    { id: 5, name: 'SUPER_DISTRIBUTOR',  level: 5, description: 'Super distributor' },
    { id: 6, name: 'MASTER_DISTRIBUTOR', level: 6, description: 'Master distributor' },
    { id: 7, name: 'DISTRIBUTOR',        level: 7, description: 'Distributor' },
    { id: 8, name: 'RETAILER',           level: 8, description: 'Retailer' },
    { id: 9, name: 'SHOPKEEPER',         level: 9, description: 'Shopkeeper — bottom of the chain' },
  ];

  for (const role of roles) {
    const exists = await knex('w_roles').where({ level: role.level }).first();
    if (!exists) await knex('w_roles').insert(role);
  }

  /* ---- 2. Root ADMIN user ---- */
  const adminEmail = 'anudeep4n@gmail.com';
  const existingAdmin = await knex('w_users').where({ email: adminEmail }).first();

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    const hashedMpin = await bcrypt.hash('123456', 10);

    const [admin] = await knex('w_users').insert({
      first_name: 'System',
      last_name: 'Admin',
      email: adminEmail,
      mobile_number: '+919999999999',
      role_id: 1,
      parent_id: null,
      password: hashedPassword,
      mpin: hashedMpin,
      deposit_limit: 0,
      withdraw_daily_limit: 0,
      is_active: true,
      is_verified: true,
    }).returning('*');

    /* ---- 3. Admin wallet ---- */
    await knex('w_wallets').insert({ user_id: admin.id, balance: 0 });

    console.log(`[seed] Admin user created: ${adminEmail} / Admin@123 / MPIN 123456`);
  }

  /* ---- 4. Default commission configs ---- */
  /* Example: when a SHOPKEEPER (9) swipes, the rates for each ancestor level */
  const defaultRates = [
    /* transaction_role_level, beneficiary_role_level, percentage */
    { transaction_role_level: 9, beneficiary_role_level: 8, percentage: 0.5 },
    { transaction_role_level: 9, beneficiary_role_level: 7, percentage: 0.3 },
    { transaction_role_level: 9, beneficiary_role_level: 6, percentage: 0.3 },
    { transaction_role_level: 9, beneficiary_role_level: 5, percentage: 0.3 },
    { transaction_role_level: 9, beneficiary_role_level: 4, percentage: 0.3 },
    { transaction_role_level: 9, beneficiary_role_level: 3, percentage: 0.3 },
    { transaction_role_level: 9, beneficiary_role_level: 2, percentage: 0.3 },
    { transaction_role_level: 9, beneficiary_role_level: 1, percentage: 0.7 },
    /* RETAILER (8) swipes */
    { transaction_role_level: 8, beneficiary_role_level: 7, percentage: 0.4 },
    { transaction_role_level: 8, beneficiary_role_level: 6, percentage: 0.3 },
    { transaction_role_level: 8, beneficiary_role_level: 5, percentage: 0.3 },
    { transaction_role_level: 8, beneficiary_role_level: 4, percentage: 0.3 },
    { transaction_role_level: 8, beneficiary_role_level: 3, percentage: 0.3 },
    { transaction_role_level: 8, beneficiary_role_level: 2, percentage: 0.3 },
    { transaction_role_level: 8, beneficiary_role_level: 1, percentage: 0.8 },
    /* DISTRIBUTOR (7) swipes */
    { transaction_role_level: 7, beneficiary_role_level: 6, percentage: 0.4 },
    { transaction_role_level: 7, beneficiary_role_level: 5, percentage: 0.3 },
    { transaction_role_level: 7, beneficiary_role_level: 4, percentage: 0.3 },
    { transaction_role_level: 7, beneficiary_role_level: 3, percentage: 0.3 },
    { transaction_role_level: 7, beneficiary_role_level: 2, percentage: 0.3 },
    { transaction_role_level: 7, beneficiary_role_level: 1, percentage: 0.9 },
    /* MASTER_DISTRIBUTOR (6) swipes */
    { transaction_role_level: 6, beneficiary_role_level: 5, percentage: 0.5 },
    { transaction_role_level: 6, beneficiary_role_level: 4, percentage: 0.3 },
    { transaction_role_level: 6, beneficiary_role_level: 3, percentage: 0.3 },
    { transaction_role_level: 6, beneficiary_role_level: 2, percentage: 0.3 },
    { transaction_role_level: 6, beneficiary_role_level: 1, percentage: 1.0 },
    /* SUPER_DISTRIBUTOR (5) swipes */
    { transaction_role_level: 5, beneficiary_role_level: 4, percentage: 0.5 },
    { transaction_role_level: 5, beneficiary_role_level: 3, percentage: 0.4 },
    { transaction_role_level: 5, beneficiary_role_level: 2, percentage: 0.4 },
    { transaction_role_level: 5, beneficiary_role_level: 1, percentage: 1.2 },
    /* STATE_HEAD (4) swipes */
    { transaction_role_level: 4, beneficiary_role_level: 3, percentage: 0.5 },
    { transaction_role_level: 4, beneficiary_role_level: 2, percentage: 0.5 },
    { transaction_role_level: 4, beneficiary_role_level: 1, percentage: 1.5 },
  ];

  for (const rate of defaultRates) {
    const exists = await knex('w_commission_configs')
      .where({
        transaction_role_level: rate.transaction_role_level,
        beneficiary_role_level: rate.beneficiary_role_level,
      })
      .first();

    if (!exists) await knex('w_commission_configs').insert(rate);
  }

  console.log('[seed] Roles, admin, and default commission config seeded.');
}
