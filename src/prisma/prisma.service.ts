import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.TECH_DB_CONNECTION_STRING;
    
    if (!connectionString) {
      throw new Error('TECH_DB_CONNECTION_STRING environment variable is not set');
    }
    
    console.log('Initializing Prisma with connection string:', connectionString.replace(/:[^:@]+@/, ':****@'));
    
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    
    super({
      adapter,
      log: ['query', 'error', 'warn'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('✅ Prisma connected to database successfully');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    console.log('Prisma disconnected from database');
  }
}
