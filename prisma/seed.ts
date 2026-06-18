/**
 * Seed script for the User Management module.
 *
 * Idempotent: upserts a SUPERADMIN plus a realistic org spanning every role and
 * department, wiring up the reporting line (managerId). Safe to run repeatedly.
 *
 * Run with:  npx prisma db seed
 */
import { PrismaClient, Role, Department } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.TECH_DB_CONNECTION_STRING;
if (!connectionString) {
  throw new Error('TECH_DB_CONNECTION_STRING is not set');
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = 'Password123!';

interface SeedUser {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  department: Department;
  managerKey: string | null;
  jobTitle: string;
  location: string;
}

const SEED_USERS: SeedUser[] = [
  { key: 'sa', firstName: 'Aarav', lastName: 'Sharma', email: 'superadmin@maven-erp.com', role: 'SUPERADMIN', department: 'OPERATIONS', managerKey: null, jobTitle: 'Chief Operating Officer', location: 'Bengaluru, IN' },
  { key: 'admin-ops', firstName: 'Priya', lastName: 'Mehta', email: 'priya.mehta@maven-erp.com', role: 'ADMIN', department: 'OPERATIONS', managerKey: 'sa', jobTitle: 'Operations Administrator', location: 'Bengaluru, IN' },
  { key: 'admin-tech', firstName: 'Arjun', lastName: 'Desai', email: 'arjun.desai@maven-erp.com', role: 'ADMIN', department: 'TECH', managerKey: 'sa', jobTitle: 'Platform Administrator', location: 'Pune, IN' },
  { key: 'hod-tech', firstName: 'Rohan', lastName: 'Gupta', email: 'rohan.gupta@maven-erp.com', role: 'HOD', department: 'TECH', managerKey: 'admin-ops', jobTitle: 'Head of Engineering', location: 'Hyderabad, IN' },
  { key: 'lead-tech', firstName: 'Ananya', lastName: 'Iyer', email: 'ananya.iyer@maven-erp.com', role: 'LEAD', department: 'TECH', managerKey: 'hod-tech', jobTitle: 'Engineering Team Lead', location: 'Hyderabad, IN' },
  { key: 'assoc-tech-1', firstName: 'Karan', lastName: 'Singh', email: 'karan.singh@maven-erp.com', role: 'ASSOCIATE', department: 'TECH', managerKey: 'lead-tech', jobTitle: 'Software Engineer', location: 'Remote, IN' },
  { key: 'assoc-tech-2', firstName: 'Sneha', lastName: 'Reddy', email: 'sneha.reddy@maven-erp.com', role: 'ASSOCIATE', department: 'TECH', managerKey: 'lead-tech', jobTitle: 'Software Engineer', location: 'Chennai, IN' },
  { key: 'hod-mkt', firstName: 'Vikram', lastName: 'Nair', email: 'vikram.nair@maven-erp.com', role: 'HOD', department: 'MARKETING', managerKey: 'admin-ops', jobTitle: 'Head of Marketing', location: 'Mumbai, IN' },
  { key: 'lead-mkt', firstName: 'Isha', lastName: 'Kapoor', email: 'isha.kapoor@maven-erp.com', role: 'LEAD', department: 'MARKETING', managerKey: 'hod-mkt', jobTitle: 'Brand & Content Lead', location: 'Mumbai, IN' },
  { key: 'assoc-mkt', firstName: 'Aditya', lastName: 'Rao', email: 'aditya.rao@maven-erp.com', role: 'ASSOCIATE', department: 'MARKETING', managerKey: 'lead-mkt', jobTitle: 'Marketing Associate', location: 'Remote, IN' },
  { key: 'hod-hr', firstName: 'Meera', lastName: 'Joshi', email: 'meera.joshi@maven-erp.com', role: 'HOD', department: 'HR', managerKey: 'admin-ops', jobTitle: 'Head of People', location: 'Bengaluru, IN' },
  { key: 'lead-sales', firstName: 'Rahul', lastName: 'Verma', email: 'rahul.verma@maven-erp.com', role: 'LEAD', department: 'SALES', managerKey: 'admin-ops', jobTitle: 'Regional Sales Lead', location: 'Delhi, IN' },
  { key: 'assoc-sales', firstName: 'Nisha', lastName: 'Pillai', email: 'nisha.pillai@maven-erp.com', role: 'ASSOCIATE', department: 'SALES', managerKey: 'lead-sales', jobTitle: 'Account Executive', location: 'Delhi, IN' },
];

async function main() {
  console.log('🌱 Seeding users...');
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const idByKey = new Map<string, string>();

  // First pass: upsert users without manager links.
  for (const u of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        department: u.department,
        jobTitle: u.jobTitle,
        location: u.location,
        isActive: true,
      },
      create: {
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        passwordHash,
        role: u.role,
        department: u.department,
        jobTitle: u.jobTitle,
        location: u.location,
      },
    });
    idByKey.set(u.key, user.id);
  }

  // Second pass: wire up manager relationships now that all IDs exist.
  for (const u of SEED_USERS) {
    if (!u.managerKey) continue;
    await prisma.user.update({
      where: { id: idByKey.get(u.key)! },
      data: { managerId: idByKey.get(u.managerKey)! },
    });
  }

  console.log(`✅ Seeded ${SEED_USERS.length} users. Default password: ${DEFAULT_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
