import { PrismaClient } from '@prisma/client';

// Helper function to get database URL from multiple environment variables
const getDatabaseUrl = () => {
    // Try multiple environment variable names in order of preference
    const possibleUrls = [
        process.env.DATABASE_URL,
        process.env.DATABASE_POSTGRES_URL,
        process.env.DATABASE_PRISMA_DATABASE_URL,
        process.env.DATABASE_DATABASE_URL
    ];
    
    // Return the first non-empty URL found
    const dbUrl = possibleUrls.find(url => url && url.trim() !== '');
    
    if (!dbUrl) {
        console.warn('⚠️ No database URL found in environment variables');
        console.log('🔍 Checked these variables:');
        console.log('   - DATABASE_URL');
        console.log('   - DATABASE_POSTGRES_URL');
        console.log('   - DATABASE_PRISMA_DATABASE_URL');
        console.log('   - DATABASE_DATABASE_URL');
    }
    
    return dbUrl;
};

// Create Prisma client with environment-specific configuration
const createPrismaClient = () => {
    const dbUrl = getDatabaseUrl();
    
    if (!dbUrl) {
        throw new Error('No database URL configured. Please set one of the DATABASE_* environment variables.');
    }
    
    const clientConfig = {
        log: []
    };
    
    if (process.env.NODE_ENV === 'production') {
        clientConfig.log = ['warn', 'error'];
    } else {
        clientConfig.log = ['query', 'warn', 'error'];
    }
    
    return new PrismaClient(clientConfig);
};

// Global variable to store the Prisma Client instance
let prisma;

if (process.env.NODE_ENV === 'production') {
    // Production: Use a single instance
    prisma = createPrismaClient();
} else {
    // Development: Use global variable to prevent multiple instances
    if (!global.__prisma__) {
        global.__prisma__ = createPrismaClient();
    }
    prisma = global.__prisma__;
}

// Helper function to safely close the database connection
const closeDatabase = async () => {
    await prisma.$disconnect();
};

// Helper function to test the connection
const testConnection = async () => {
    try {
        const dbUrl = getDatabaseUrl();
        if (!dbUrl) {
            console.log('❌ No database URL configured');
            return false;
        }
        
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Database connection successful');
        console.log(`📡 Connected to: ${dbUrl}`);
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// Helper function to upsert a car record
const upsertCar = async (carData) => {
    try {
        // Validate required fields
        if (!carData.stock) {
            throw new Error('Stock number is required for upsert');
        }
        
        const result = await prisma.car.upsert({
            where: { stock: carData.stock },
            update: {
                ...carData,
                updatedAt: new Date()
            },
            create: {
                ...carData,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        });
        
        console.log(`💾 ${result.id ? 'Updated' : 'Created'} car: ${carData.stock}`);
        return result;
    } catch (error) {
        console.error(`❌ Error upserting car ${carData.stock}:`, error.message);
        throw error;
    }
};

// Helper function to get database statistics
const getStats = async () => {
    try {
        const count = await prisma.car.count();
        const recent = await prisma.car.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5
        });
        return { totalCars: count, recentCars: recent };
    } catch (error) {
        console.error('❌ Error getting stats:', error.message);
        return { totalCars: 0, recentCars: [] };
    }
};

// Helper function to show connection information
const showConnectionInfo = () => {
    const dbUrl = getDatabaseUrl();
    if (dbUrl) {
        // Mask password in URL for security
        const maskedUrl = dbUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
        console.log(`📡 Database URL: ${maskedUrl}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    } else {
        console.log('❌ No database URL configured');
    }
};

export {
    prisma,
    closeDatabase,
    testConnection,
    upsertCar,
    getStats,
    showConnectionInfo,
    getDatabaseUrl
};