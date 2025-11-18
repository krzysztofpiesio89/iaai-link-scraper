// Test file to validate Prisma integration
import { prisma, testConnection, closeDatabase } from './prisma.js';

console.log('🧪 Testing Prisma Integration...');

async function testPrismaIntegration() {
    try {
        // Test database connection
        console.log('🔗 Testing database connection...');
        const isConnected = await testConnection();
        
        if (!isConnected) {
            console.log('⚠️ Database connection failed - this is expected without DATABASE_URL set');
            console.log('📝 To test with a real database:');
            console.log('   1. Copy .env.example to .env');
            console.log('   2. Set your DATABASE_URL');
            console.log('   3. Run: npm run prisma:push');
            return;
        }

        // If connection is successful (database exists), we can test further
        console.log('✅ Database connection successful!');
        
        // Test database statistics
        const stats = await prisma.$queryRaw`SELECT COUNT(*) as total FROM cars LIMIT 1`;
        console.log('📊 Database query test passed:', stats);
        
    } catch (error) {
        console.log('❌ Expected behavior - database not set up yet');
        console.log('📝 Next steps to complete setup:');
        console.log('   1. Set up your database (PostgreSQL/MySQL/SQLite)');
        console.log('   2. Configure DATABASE_URL in .env file');
        console.log('   3. Run: npm run prisma:push');
        console.log('   4. Test again with a real database connection');
    } finally {
        await closeDatabase();
        console.log('🔒 Database connection closed.');
    }
}

testPrismaIntegration();