# 🚀 IAAI Auction Link Scraper with Prisma Integration

This enhanced Apify Actor scrapes auction links from IAAI.com and saves vehicle data directly to a PostgreSQL database using Prisma ORM. It extracts comprehensive vehicle information and stores it in a structured database format for easy querying and analysis.

## 🆕 Prisma Integration Features

- **Direct Database Storage**: Saves vehicle data directly to PostgreSQL/MySQL/SQLite
- **Upsert Support**: Automatically updates existing records based on stock number
- **Data Type Conversion**: Automatically converts scraped strings to proper data types
- **Connection Management**: Handles database connections efficiently with connection pooling
- **Error Handling**: Robust error handling for database operations
- **Statistics Tracking**: Tracks database operations and provides detailed statistics

## 🚀 Key Features

- **Enhanced Data Extraction**: Gathers detailed vehicle information from IAAI search results
- **Prisma ORM Integration**: Uses Prisma for type-safe database operations
- **Environment Variable Support**: Configurable database connection via environment variables
- **Robust & Resilient**: Finds data by semantic labels rather than brittle CSS selectors
- **Proxy Support**: Integrates seamlessly with Apify Proxies
- **Database Statistics**: Provides real-time database operation statistics

## 🗄️ Database Schema

The scraper uses the following Prisma schema:

```prisma
model Car {
  id                    Int                      @id @default(autoincrement())
  stock                 String                   @unique
  year                  Int
  make                  String
  model                 String
  damageType            String
  mileage               Int?
  engineStatus          String
  bidPrice              Float
  buyNowPrice           Float?
  auctionDate           DateTime?
  detailUrl             String
  imageUrl              String
  version               String?
  origin                String?
  vin                   String?
  engineInfo            String?
  fuelType              String?
  cylinders             String?
  videoUrl              String?
  is360                 Boolean?                 @default(false)
  engineCapacityL       Float?
  cylinderArrangement   String?
  injectionType         String?
  camshaftType          String?
  valveTiming           String?
  isTurbo               Boolean?
  horsepower            Int?
  createdAt             DateTime                 @default(now())
  updatedAt             DateTime                 @updatedAt

  // Relations
  auctionParticipations AuctionParticipation[]
  favorites             Favorite[]
}
```

## 📦 Installation & Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Configure your database connection in `.env`:**
   ```bash
   # PostgreSQL (recommended)
   DATABASE_URL="postgresql://username:password@localhost:5432/copart_api?schema=public"
   
   # MySQL
   DATABASE_URL="mysql://username:password@localhost:3306/copart_api"
   
   # SQLite (development)
   DATABASE_URL="file:./dev.db"
   ```

3. **Generate Prisma client:**
   ```bash
   npm run prisma:generate
   ```

4. **Push database schema:**
   ```bash
   npm run prisma:push
   ```

   Or using npx:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

### 3. Run the Scraper

```bash
npm start
```

## 🎯 Input Configuration

The Actor supports the following input parameters:

- **startUrls**: IAAI search URLs to scrape
- **maxRequestsPerCrawl**: Maximum requests (default: 1000)
- **maxConcurrency**: Concurrent requests (default: 1)
- **proxyConfiguration**: Apify proxy settings (recommended)
- **headless**: Browser headless mode (default: true)
- **debugMode**: Enable debug logging (default: false)
- **maxPages**: Maximum pages to scrape (default: 99999)

## 📊 Database Statistics

The scraper provides detailed statistics:

```javascript
{
  pagesProcessed: 5,
  vehiclesFound: 150,
  totalVehiclesOnSite: 1847,
  errors: 2,
  dbSaved: 148,
  dbErrors: 2,
  duration: "45s"
}
```

## 🔍 Output Format

Each vehicle is stored as a Car record with the following data structure:

```json
{
  "stock": "39735871",
  "year": 2021,
  "make": "TESLA",
  "model": "MODEL 3",
  "damageType": "FRONT END",
  "mileage": 24814,
  "engineStatus": "RUNS",
  "bidPrice": 12500.50,
  "buyNowPrice": 15000.00,
  "detailUrl": "https://www.iaai.com/VehicleDetail/39735871",
  "imageUrl": "https://cdn.iaai.com/...",
  "vin": "5YJ3E1EB4MFXXXXXX",
  "engineInfo": "Electric",
  "fuelType": "Electric",
  "is360": true,
  "createdAt": "2025-09-25T15:30:00.000Z",
  "updatedAt": "2025-09-25T15:30:00.000Z"
}
```

## 🛠️ Prisma Commands

```bash
# Generate Prisma client
npm run prisma:generate

# Push schema to database
npm run prisma:push

# Open Prisma Studio (database GUI)
npm run prisma:studio
```

## 🐛 Troubleshooting

### Database Connection Issues

1. **Check DATABASE_URL**: Ensure your `.env` file contains the correct database connection string
2. **Database Accessibility**: Verify your database server is running and accessible
3. **Prisma Client**: Run `npm run prisma:generate` after changing the schema

### Data Type Issues

The scraper automatically converts data types:
- **String to Number**: Mileage, bid prices, buy now prices
- **String to Date**: Auction dates
- **String to Boolean**: 360° view availability
- **Empty Strings**: Converted to null for optional fields

### Performance Optimization

- **Connection Pooling**: Prisma automatically manages connection pooling
- **Upsert Operations**: Uses `upsert` to prevent duplicate records
- **Batch Processing**: Processes vehicles in batches with progress reporting

## 📈 Database Monitoring

Monitor your database using Prisma Studio:

```bash
npm run prisma:studio
```

This opens a web interface to view, edit, and manage your scraped vehicle data.

## 🔄 Data Flow

1. **Scraping**: Playwright extracts vehicle data from IAAI search results
2. **Data Cleaning**: Automatic conversion of strings to proper data types
3. **Database Operations**: Upsert operations to save/update vehicle records
4. **Statistics**: Real-time tracking of database operations
5. **Output**: Both database storage and traditional Apify dataset (for compatibility)

## 🎉 Example Usage

1. Set up your database connection in `.env`
2. Initialize Prisma: `npm run prisma:generate && npm run prisma:push`
3. Start the scraper: `npm start`
4. Monitor progress: Check console output for database statistics
5. View data: Use `npm run prisma:studio` to inspect scraped vehicles

The scraper will automatically handle duplicate vehicles based on the `stock` field and provide detailed statistics on successful database operations.