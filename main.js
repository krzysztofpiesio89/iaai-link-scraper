import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { prisma, testConnection, upsertCar, closeDatabase, getStats, showConnectionInfo } from './prisma.js';

await Actor.init();
console.log('🚀 IAAI Enhanced Data Scraper (V6 - Prisma Integration) - Starting...');

const input = await Actor.getInput() ?? {};
const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType' }],
    maxRequestsPerCrawl = 1000,
    maxConcurrency = 1,
    proxyConfiguration,
    headless = true,
    debugMode = false,
    maxPages = 99999 
} = input;

const proxyConfigurationInstance = await Actor.createProxyConfiguration(proxyConfiguration);
const dataset = await Dataset.open();

console.log('🔗 Database Configuration:');
showConnectionInfo();

console.log('\n🔗 Testing database connection...');
const dbConnected = await testConnection();
if (!dbConnected) {
    console.error('❌ Database connection failed. Please check your environment variables:');
    console.log('   DATABASE_URL');
    console.log('   DATABASE_POSTGRES_URL');
    console.log('   DATABASE_PRISMA_DATABASE_URL');
    console.log('   DATABASE_DATABASE_URL');
    await Actor.exit();
}

console.log('\n📊 Initial database statistics:');
const initialStats = await getStats();
console.log(`   Total cars in database: ${initialStats.totalCars}`);
console.log(`   Recent cars: ${initialStats.recentCars.length} added in last session`);

const stats = { 
    pagesProcessed: 0, 
    vehiclesFound: 0, 
    totalVehiclesOnSite: 'N/A', 
    errors: 0, 
    startTime: new Date(),
    dbSaved: 0,
    dbErrors: 0
};

// --- FUNKCJA DO EKSTRAKCJI DANYCH ---
const extractVehicleDataFromList = async (page) => {
    return page.evaluate(() => {
        const results = [];
        document.querySelectorAll('div.table-row.table-row-border').forEach(row => {
            try {
                const getTextByTitle = (prefix) => {
                    const element = row.querySelector(`span[title^="${prefix}"]`);
                    return element ? element.textContent.trim() : null;
                };
                
                const getText = (selector) => {
                    const element = row.querySelector(selector);
                    return element ? element.textContent.trim() : null;
                };

                const linkElement = row.querySelector('h4.heading-7 a');
                if (!linkElement) return;

                const detailUrl = new URL(linkElement.getAttribute('href'), location.origin).href;
                const fullTitle = linkElement.textContent.trim();
                const imageUrl = row.querySelector('.table-cell--image img')?.getAttribute('data-src') || row.querySelector('.table-cell--image img')?.getAttribute('src');

                const yearMatch = fullTitle.match(/^\d{4}/);
                const year = yearMatch ? parseInt(yearMatch[0]) : null;

                let make = null;
                let model = null;
                let version = null;

                if (year) {
                    const restOfTitle = fullTitle.substring(year.toString().length).trim();
                    const parts = restOfTitle.split(' ');
                    make = parts.shift() || null; 
                    model = parts.shift() || null;
                    version = parts.join(' ').trim();
                }

                let stock = null;
                let vin = null;
                
                const dataItems = row.querySelectorAll('.data-list__item');
                dataItems.forEach(item => {
                    const labelElement = item.querySelector('.data-list__label');
                    if (labelElement) {
                        const labelText = labelElement.textContent.trim();
                        if (labelText.startsWith('Stock #:')) {
                            stock = item.querySelector('.data-list__value')?.textContent.trim() || null;
                        }
                        if (labelText.startsWith('VIN:')) {
                            vin = labelElement.nextElementSibling?.textContent.trim() || null;
                        }
                    }
                });

                const primaryDamage = getTextByTitle("Primary Damage:");
                const lossType = getTextByTitle("Loss:");
                const damageParts = [primaryDamage, lossType].filter(Boolean);
                const damageType = damageParts.length > 0 ? damageParts.join(' / ') : "";
                
                const mileage = getTextByTitle("Odometer:");
                const mileageNum = mileage ? parseInt(mileage.replace(/,/g, '')) : null;
                
                const engineInfo = getTextByTitle("Engine:");
                const fuelType = getTextByTitle("Fuel Type:");
                const cylinders = getTextByTitle("Cylinder:");
                const origin = getText('span[title^="Branch:"] a');
                const engineStatus = getText('.badge') || 'Unknown';
                
                let bidPrice = getText('.btn--pre-bid') || getText('[data-testid="current-bid-price"]');
                const acvValue = getTextByTitle("ACV:");
                
                if (bidPrice && bidPrice.trim().toLowerCase() === 'pre-bid' && acvValue) {
                    bidPrice = acvValue.trim();
                }
                
                const bidPriceNum = bidPrice ? parseFloat(bidPrice.replace(/[$,]/g, '')) : 0;
                
                let buyNowPrice = null;
                const actionLinks = row.querySelectorAll('.data-list--action a');
                actionLinks.forEach(link => {
                    const linkText = link.textContent.trim();
                    if (linkText.startsWith('Buy Now')) {
                        buyNowPrice = linkText.replace('Buy Now ', '');
                    }
                });
                
                const buyNowPriceNum = buyNowPrice ? parseFloat(buyNowPrice.replace(/[$,]/g, '')) : null;
                
                const auctionDate = getText('.data-list__value--action');
                const is360 = !!row.querySelector('span.media_360_view');
                const videoUrl = stock ? `https://mediastorageaccountprod.blob.core.windows.net/media/${stock}_VES-100_1` : null;

                results.push({
                    stock,
                    year,
                    make,
                    model,
                    version,
                    auctionDate,
                    is360,
                    damageType,
                    mileage: mileageNum,
                    engineStatus,
                    origin,
                    vin,
                    engineInfo,
                    fuelType,
                    cylinders,
                    bidPrice: bidPriceNum,
                    buyNowPrice: buyNowPriceNum,
                    videoUrl,
                    detailUrl,
                    imageUrl,
                });
            } catch (e) {
                console.warn('Could not process a vehicle row:', e.message);
            }
        });
        return results;
    });
};

// --- FUNKCJE POMOCNICZE ---

const waitForLoaderToDisappear = async (page, timeout = 20000) => {
    try {
        console.log('...waiting for page loader to disappear...');
        await page.waitForSelector('.circle-loader-shape', { state: 'hidden', timeout });
        console.log('✅ Loader disappeared.');
    } catch (e) {
        console.log('⚠️ Loader did not disappear in time, but continuing anyway.');
    }
};

const handleCookieConsent = async (page) => {
    try {
        const cookieSelectors = ['#truste-consent-button'];
        for (const selector of cookieSelectors) {
            const button = page.locator(selector).first();
            if (await button.isVisible({ timeout: 2000 })) {
                console.log('🍪 Accepting cookie consent...');
                await button.click();
                return true;
            }
        }
    } catch (error) { /* Ignore */ }
    return false;
};

const waitForResults = async (page, timeout = 25000) => {
    console.log('⏳ Waiting for search results to load...');
    try {
        await page.waitForSelector('a[href^="/VehicleDetail/"]', { timeout });
        await waitForLoaderToDisappear(page);
        console.log('✅ Vehicle detail links found and page is ready.');
        return true;
    } catch (e) {
        console.log(`⚠️ No vehicle links found within ${timeout}ms timeout.`);
        return false;
    }
};

const getTotalAuctionsCount = async (page) => {
    try {
        console.log('...Attempting to extract total count using page content (Regex)...');
        
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        const content = await page.content();
        
        const primaryRegex = /<label[^>]*class="[^"]*label--total[^"]*"[^>]*>([\d,]+)<\/label>/i;
        let match = content.match(primaryRegex);

        if (match && match[1]) {
            const rawCount = match[1];
            const count = parseInt(rawCount.replace(/,/g, ''), 10);
            
            if (!isNaN(count)) {
                 console.log(`✅ Extracted total count using primary Regex (label.label--total): ${count}`);
                 return count;
            }
        }
        
        const fallbackRegex = /([\d,]+)\s*(?:VEHICLES|TotalAmount|TOTAL)/i;
        match = content.match(fallbackRegex);
        
        if (match && match[1]) {
             const rawCount = match[1];
             const count = parseInt(rawCount.replace(/,/g, ''), 10);
             if (!isNaN(count)) {
                 console.log(`✅ Extracted total count using fallback Regex (near 'VEHICLES'): ${count}`);
                 return count;
             }
        }
        
        console.log(`⚠️ Regex extraction failed. Total count not found in HTML content.`);
        return 'N/A';
    } catch (error) {
        console.log(`❌ Error during Regex extraction: ${error.message}`);
        return 'N/A';
    }
};

// --- FUNKCJA DO NAWIGACJI PO STRONACH ---
const navigateToPageNumber = async (page, pageNumber) => {
    try {
        const pageButtonSelector = `button#PageNumber${pageNumber}`;
        const pageButton = page.locator(pageButtonSelector);
        if (await pageButton.count() > 0 && await pageButton.isEnabled()) {
            console.log(`🔢 Clicking page number button: ${pageNumber}`);
            
            const firstLinkLocator = page.locator('a[href^="/VehicleDetail/"]').first();
            const hrefBeforeClick = await firstLinkLocator.getAttribute('href');
            
            await waitForLoaderToDisappear(page);
            await pageButton.scrollIntoViewIfNeeded();
            await pageButton.click();

            console.log(`⏳ Waiting for content to update...`);
            await page.waitForFunction((expectedOldHref) => {
                const currentFirstLink = document.querySelector('a[href^="/VehicleDetail/"]');
                return currentFirstLink && currentFirstLink.getAttribute('href') !== expectedOldHref;
            }, hrefBeforeClick, { timeout: 20000 });
            console.log(`✅ Successfully navigated to page ${pageNumber}`);
            return true;
        }
        return false;
    } catch (error) {
        return false; 
    }
};

// --- FUNKCJA DO ZAPISYWANIA DO BAZY DANYCH ---
const saveVehiclesToDatabase = async (vehiclesData) => {
    let savedCount = 0;
    let errorCount = 0;
    
    for (const vehicle of vehiclesData) {
        try {
            // Skip if stock number is missing (required field)
            if (!vehicle.stock) {
                console.log(`⚠️ Skipping vehicle without stock number`);
                continue;
            }
            
            // Convert data types to match Prisma schema
            const carData = {
                stock: vehicle.stock,
                year: vehicle.year || 2020,
                make: vehicle.make || 'Unknown',
                model: vehicle.model || 'Unknown',
                damageType: vehicle.damageType || '',
                mileage: vehicle.mileage || null,
                engineStatus: vehicle.engineStatus || 'Unknown',
                bidPrice: vehicle.bidPrice || 0,
                buyNowPrice: vehicle.buyNowPrice || null,
                auctionDate: vehicle.auctionDate ? new Date(vehicle.auctionDate) : null,
                detailUrl: vehicle.detailUrl || '',
                imageUrl: vehicle.imageUrl || '',
                version: vehicle.version || null,
                origin: vehicle.origin || null,
                vin: vehicle.vin || null,
                engineInfo: vehicle.engineInfo || null,
                fuelType: vehicle.fuelType || null,
                cylinders: vehicle.cylinders || null,
                videoUrl: vehicle.videoUrl || null,
                is360: vehicle.is360 || false,
            };
            
            await upsertCar(carData);
            savedCount++;
            
            if (savedCount % 10 === 0) {
                console.log(`💾 Saved ${savedCount} vehicles to database so far...`);
            }
            
        } catch (error) {
            errorCount++;
            console.error(`❌ Error saving vehicle ${vehicle.stock}:`, error.message);
        }
    }
    
    return { saved: savedCount, errors: errorCount };
};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfigurationInstance,
    maxConcurrency,
    requestHandlerTimeoutSecs: 300,
    navigationTimeoutSecs: 120,
    launchContext: { launchOptions: { headless, args: ['--no-sandbox'] } },

    async requestHandler({ page, request }) {
        console.log(`📖 Processing: ${request.url}`);
        try {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 }); 
            await handleCookieConsent(page);
            if (!await waitForResults(page)) {
                console.log('Stopping processing for this URL as no results were found.');
                return;
            }
            
            // Pobieramy łączną liczbę aukcji
            const totalCount = await getTotalAuctionsCount(page);
            stats.totalVehiclesOnSite = totalCount;
            console.log(`\n🎉 Total auctions found on site: ${totalCount}`);

            let currentPage = 1;
            
            while (true) {
                console.log(`\n📄 === Scraping page ${currentPage} ===`);

                const vehiclesData = await extractVehicleDataFromList(page);
                console.log(`✅ Found ${vehiclesData.length} vehicles on page ${currentPage}`);

                // WARUNEK ZAKOŃCZENIA 1: Jeśli nie znaleziono żadnych pojazdów na stronie
                if (vehiclesData.length === 0) {
                   console.log('⚠️ No vehicles found on this page. Stopping pagination.');
                   break;
                }
                
                stats.vehiclesFound += vehiclesData.length;
                
                // ZAPISYWANIE DO BAZY DANYCH
                console.log('💾 Saving vehicles to database...');
                const { saved, errors } = await saveVehiclesToDatabase(vehiclesData);
                stats.dbSaved += saved;
                stats.dbErrors += errors;
                
                await dataset.pushData(vehiclesData); // Keep original dataset for compatibility
                stats.pagesProcessed = currentPage;

                // --- LOGIKA NAWIGACJI ---
                const nextPageNumber = currentPage + 1;
                let navigationSuccess = await navigateToPageNumber(page, nextPageNumber);

                // WARUNEK ZAKOŃCZENIA 2: Jeśli ŻADNA nawigacja nie powiodła się
                if (navigationSuccess) {
                    currentPage++;
                } else {
                    console.log('🏁 No more navigation buttons available (or page number button not active). End of pagination.');
                    break;
                }
                
                // *** DODATKOWY WARUNEK ZAKOŃCZENIA (pomocniczy) ***
                if (typeof stats.totalVehiclesOnSite === 'number' && stats.vehiclesFound >= stats.totalVehiclesOnSite) {
                    console.log(`\n🛑 Reached or exceeded the reported total of ${stats.totalVehiclesOnSite} vehicles. Stopping crawl.`);
                    break;
                }
            }
        } catch (error) {
            console.log(`❌ Main error processing ${request.url}:`, error.message);
            stats.errors++;
        }
    },
    failedRequestHandler: async ({ request }) => {
        console.log(`❌ Request completely failed: ${request.url}`);
        stats.errors++;
    }
});

await crawler.addRequests(startUrls);
console.log('🏃‍♂️ Starting crawler...');
await crawler.run();

stats.endTime = new Date();
stats.duration = (stats.endTime - stats.startTime);

console.log('\n' + '='.repeat(50));
console.log('🎉 Crawling completed!');
console.log('📊 Final Statistics:', {
    pagesProcessed: stats.pagesProcessed,
    vehiclesFound: stats.vehiclesFound,
    totalVehiclesOnSite: stats.totalVehiclesOnSite, 
    errors: stats.errors,
    dbSaved: stats.dbSaved,
    dbErrors: stats.dbErrors,
    duration: `${Math.round(stats.duration / 1000)}s`,
});

console.log('\n📊 Final Database Statistics:');
const finalStats = await getStats();
console.log(`   Total cars in database: ${finalStats.totalCars}`);
console.log(`   Cars added this session: ${stats.dbSaved}`);

console.log('='.repeat(50));

// Close database connection
await closeDatabase();
console.log('🔒 Database connection closed.');

await Actor.exit();