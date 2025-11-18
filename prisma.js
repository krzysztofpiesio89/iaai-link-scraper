import { PrismaClient } from '@prisma/client';

// Global variable to store the Prisma Client instance
let prisma;

if (process.env.NODE_ENV === 'production') {
    // Production: Use a single instance
    prisma = new PrismaClient({
        log: ['warn', 'error']
    });
} else {
    // Development: Use global variable to prevent multiple instances
    if (!global.__prisma__) {
        global.__prisma__ = new PrismaClient({
            log: ['query', 'warn', 'error']
        });
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
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Database connection successful');
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// Helper function to upsert a car record
const upsertCar = async (carData) => {
    try {
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
        return result;
    } catch (error) {
        console.error('❌ Error upserting car:', error.message);
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

export {
    prisma,
    closeDatabase,
    testConnection,
    upsertCar,
    getStats
};