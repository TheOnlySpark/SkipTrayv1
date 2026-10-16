/**
 * OPERATOR CLI: SECURE SUPER ADMIN PROVISIONING SCRIPT
 * 
 * Usage:
 *   npx tsx scripts/provision_super_admin.ts --email admin@example.com [--name "Super Admin"]
 * 
 * Requirements:
 *   - SUPABASE_URL (or VITE_SUPABASE_URL) set in environment
 *   - SUPABASE_SERVICE_ROLE_KEY set in environment
 */

import { AdminProvisioningService } from '../src/services/adminProvisioningService';
import dotenv from 'dotenv';
dotenv.config();

function parseArgs(): { email: string; name?: string } {
  const args = process.argv.slice(2);
  let email = '';
  let name = 'Platform Super Administrator';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' || args[i] === '-e') {
      email = args[i + 1] || '';
      i++;
    } else if (args[i] === '--name' || args[i] === '-n') {
      name = args[i + 1] || name;
      i++;
    }
  }

  if (!email && process.env.PROVISION_ADMIN_EMAIL) {
    email = process.env.PROVISION_ADMIN_EMAIL;
  }

  return { email, name };
}

async function run() {
  console.log('================================================================');
  console.log('SKIP TRAY — SECURE SUPER ADMIN PROVISIONING');
  console.log('================================================================');

  const { email, name } = parseArgs();

  if (!email) {
    console.error('❌ Error: Email address is required.');
    console.log('\nUsage:');
    console.log('  npx tsx scripts/provision_super_admin.ts --email admin@example.com [--name "Name"]');
    console.log('Or set PROVISION_ADMIN_EMAIL in your environment.\n');
    process.exit(1);
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY is not defined in the environment.');
    console.error('   Server-side privileged execution is required to provision administrators.');
    process.exit(1);
  }

  console.log(`Initiating secure provisioning for: ${AdminProvisioningService.maskEmail(email)}`);
  
  const result = await AdminProvisioningService.provisionSuperAdmin({
    email,
    name,
    serviceRoleKey,
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  });

  if (!result.success) {
    console.error(`❌ Provisioning Failed: ${result.message}`);
    process.exit(1);
  }

  console.log(`✅ Status: ${result.action}`);
  console.log(`✅ ${result.message}`);
  console.log('🔒 Security Note: Mandatory first-login password setup has been enforced server-side.');
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('❌ Unexpected Fatal Error:', err.message || err);
  process.exit(1);
});
