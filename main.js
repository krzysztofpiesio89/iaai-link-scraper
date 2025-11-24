import { Actor } from 'apify';
// DODANO: KeyValueStore do zapisu stanu
import { PlaywrightCrawler, Dataset, KeyValueStore } from 'crawlee';
import { prisma, testConnection, upsertCar, closeDatabase, getStats, showConnectionInfo } from './prisma.js';

await Actor.init();
console.log('🚀 IAAI Enhanced Data Scraper (V9 - Auto-Resume + Anti-Timeout) - Starting...');

const input = await Actor.getInput() ?? {};
const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType' }],
    maxRequestsPerCrawl = 20000,
    maxConcurrency = 1,
    proxyConfiguration,
    headless = true,
    debugMode = false,
    maxPages = 99999 
} = input;

const proxyConfigurationInstance = await Actor.createProxyConfiguration(proxyConfiguration);
const dataset = await Dataset.open();

// --- LOGIKA PARSOWANIA (ZGODNA Z SYSTEMEM UPLOAD) ---
const parseField = {
    toInt: (value) => {
        if (!value) return null;
        // Konwersja na string w razie gdyby przyszła liczba
        const strVal = String(value);
        const parsed = parseInt(strVal.replace(/[^0-9]/g, ''), 10);
        return isNaN(parsed) ? null : parsed;
    },
    toKmFromMiles: (value) => {
        if (!value) return null;
        const strVal = String(value);
        const miles = parseInt(strVal.replace(/[^0-9]/g, ''), 10);
        if (isNaN(miles)) return null;
        return Math.round(miles * 1.60934);
    },
    toFloat: (value) => {
        if (!value) return null;
        const strVal = String(value);
        const cleanedValue = strVal.replace(/,/g, '').replace(/[^0-9.]/g, '');
        const parsed = parseFloat(cleanedValue);
        return isNaN(parsed) ? null : parsed;
    },
    toDate: (value) => {
        if (!value) return null;
        try {
            const strVal = String(value);
            const monthMap = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
            const tzOffsets = { 'EDT': '-04:00', 'EST': '-05:00', 'CDT': '-05:00', 'CST': '-06:00', 'MDT': '-06:00', 'MST': '-07:00', 'PDT': '-07:00', 'PST': '-08:00' };
            
            const dateParts = strVal.match(/(\w{3})\s(\d{1,2})/);
            const timeParts = strVal.match(/(\d{1,2})(?::(\d{2}))?(am|pm)\s([A-Z]{3})/);
            
            if (!dateParts || !timeParts) return null;
            
            const [, monthStr, day] = dateParts;
            const [, hourStr, minute, ampm, tz] = timeParts;
            
            const finalMinute = minute || '00';
            const month = monthMap[monthStr];
            const year = new Date().getFullYear();
            
            let hour = parseInt(hourStr, 10);
            if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
            if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
            
            const offset = tzOffsets[tz];
            
            // Fallback dla braku offsetu lub miesiąca
            if (!month || !offset) return null;
            
            const isoString = `${year}-${month}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${finalMinute}:00${offset}`;
            const finalDate = new Date(isoString);
            
            return isNaN(finalDate.getTime()) ? null : finalDate;
        } catch (error) { 
            console.warn('Error parsing date:', error.message);
            return null; 
        }
    }
};

// --- KONFIGURACJA STANU (RESUME) ---
const STATE_KEY = 'CRAWLER_STATE';
const savedState = await KeyValueStore.getValue(STATE_KEY) || { lastPageProcessed: 0 };
if (savedState.lastPageProcessed > 0) {
    console.log(`💾 FOUND SAVED STATE: Last successfully processed page was ${savedState.lastPageProcessed}. Will attempt to resume.`);
}

console.log('🔗 Database Configuration:');
showConnectionInfo();

console.log('\n🔗 Testing database connection...');
const dbConnected = await testConnection();
if (!dbConnected) {
    console.error('❌ Database connection failed. Please check your environment variables.');
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
                
                // Pobieramy jako tekst, parsowanie zrobimy w Node.js za pomocą parseField
                const mileage = getTextByTitle("Odometer:");
                
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
                
                let buyNowPrice = null;
                const actionLinks = row.querySelectorAll('.data-list--action a');
                actionLinks.forEach(link => {
                    const linkText = link.textContent.trim();
                    if (linkText.startsWith('Buy Now')) {
                        buyNowPrice = linkText.replace('Buy Now ', '');
                    }
                });
                
                // Pobieramy surowy ciąg daty (np. "Oct 24 10:00am CDT")
                const auctionDate = getText('.data-list__value--action');
                const is360 = !!row.querySelector('span.media_360_view');
                const videoUrl = stock ? `https://mediastorageaccountprod.blob.core.windows.net/media/${stock}_VES-100_1` : null;

                results.push({
                    stock,
                    year,
                    make,
                    model,
                    version,
                    auctionDate, // Raw string
                    is360,
                    damageType,
                    mileage, // Raw string
                    engineStatus,
                    origin,
                    vin,
                    engineInfo,
                    fuelType,
                    cylinders,
                    bidPrice, // Raw string
                    buyNowPrice, // Raw string
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

// --- FUNKCJE POMOCNICZE (Stare parseDate usunięte na rzecz parseField) ---

const waitForLoaderToDisappear = async (page, timeout = 25000) => {
    try {
        await page.waitForSelector('.circle-loader-shape', { state: 'hidden', timeout });
        await page.waitForSelector('.blockUI.blockOverlay', { state: 'hidden', timeout: 5000 }).catch(() => {});
    } catch (e) {
        // Ignorujemy warningi timeoutu loadera
    }
};

const handleCookieConsent = async (page) => {
    try {
        const button = page.locator('#truste-consent-button').first();
        if (await button.isVisible({ timeout: 3000 })) {
            await button.click();
        }
    } catch (error) { /* Ignore */ }
};

const waitForResults = async (page, timeout = 30000) => {
    try {
        await page.waitForSelector('div.table-body', { timeout });
        await waitForLoaderToDisappear(page);
        return true;
    } catch (e) {
        console.log(`⚠️ No results table found.`);
        return false;
    }
};

const getTotalAuctionsCount = async (page) => {
    try {
        const content = await page.content();
        const match = content.match(/<label[^>]*class="[^"]*label--total[^"]*"[^>]*>([\d,]+)<\/label>/i);
        if (match && match[1]) return parseInt(match[1].replace(/,/g, ''), 10);
        return 'N/A';
    } catch (e) { return 'N/A'; }
};

// --- SZYBKIE PRZEWIJANIE (FAST FORWARD) ---
const fastForwardToPage = async (page, targetPage) => {
    console.log(`⏩ FAST FORWARD MODE: Jumping to page ${targetPage}...`);
    let currentRangeMax = 10;
    while (targetPage > currentRangeMax) {
        console.log(`   Current range max: ${currentRangeMax}. Target: ${targetPage}. Clicking "Next 10 Pages"...`);
        const nextTenBtn = page.locator('button.btn-next-10').first();
        if (await nextTenBtn.isVisible() && await nextTenBtn.isEnabled()) {
            await nextTenBtn.click();
            await page.waitForTimeout(1500);
            await waitForLoaderToDisappear(page);
            currentRangeMax += 10;
        } else {
            console.log('⚠️ Cannot fast forward anymore (Next 10 button missing/disabled).');
            break;
        }
    }
    console.log(`🎯 Range reached. Clicking specific page button: ${targetPage}`);
    await navigateToPageNumber(page, targetPage);
};

// --- NAWIGACJA ---
const navigateToPageNumber = async (page, targetPageNumber) => {
    try {
        await waitForLoaderToDisappear(page);
        
        const specificPageBtn = page.locator(`button#PageNumber${targetPageNumber}`);
        if (await specificPageBtn.isVisible({ timeout: 1000 }) && await specificPageBtn.isEnabled()) {
            await specificPageBtn.click();
            await waitForLoaderToDisappear(page);
            return true;
        }

        const nextTenBtn = page.locator('button.btn-next-10').first();
        const isNextTenVisible = await nextTenBtn.isVisible().catch(() => false);
        const isNextTenEnabled = await nextTenBtn.isEnabled().catch(() => false);

        if (!await specificPageBtn.isVisible() && isNextTenVisible && isNextTenEnabled) {
             console.log(`⏭️ Direct button missing. Clicking "Next 10 Pages" (btn-next-10)...`);
             await nextTenBtn.click();
             await page.waitForTimeout(2000);
             await waitForLoaderToDisappear(page);
             
             const newSpecificBtn = page.locator(`button#PageNumber${targetPageNumber}`);
             if (await newSpecificBtn.isVisible()) {
                 const classAttr = await newSpecificBtn.getAttribute('class');
                 if (!classAttr.includes('active')) {
                     await newSpecificBtn.click();
                     await waitForLoaderToDisappear(page);
                 }
             }
             return true;
        }

        const nextButton = page.locator('button.btn-next').first();
        if (await nextButton.isVisible() && await nextButton.isEnabled()) {
            await nextButton.click();
            await waitForLoaderToDisappear(page);
            return true;
        }
        
        console.log(`⚠️ Navigation failed to page ${targetPageNumber}.`);
        return false;

    } catch (error) {
        console.error(`❌ Navigation error:`, error.message);
        return false;
    }
};

// --- ZAPIS DO BAZY (ZAKTUALIZOWANY O PARSOWANIE) ---
const saveVehiclesToDatabase = async (vehiclesData) => {
    let savedCount = 0;
    let errorCount = 0;
    for (const vehicle of vehiclesData) {
        try {
            if (!vehicle.stock) continue;
            
            // TUTAJ ZASTOSOWANO NOWĄ LOGIKĘ PARSOWANIA
            const carData = {
                stock: vehicle.stock,
                year: vehicle.year || 2020,
                make: vehicle.make || 'Unknown',
                model: vehicle.model || 'Unknown',
                damageType: vehicle.damageType || '',
                
                // Konwersja mil na kilometry przy użyciu logiki uploadu
                mileage: parseField.toKmFromMiles(vehicle.mileage),
                
                engineStatus: vehicle.engineStatus || 'Unknown',
                
                // Parsowanie cen
                bidPrice: parseField.toFloat(vehicle.bidPrice) || 0,
                buyNowPrice: parseField.toFloat(vehicle.buyNowPrice),
                
                // KRYTYCZNA POPRAWKA: Parsowanie daty zgodnie z systemem upload
                auctionDate: parseField.toDate(vehicle.auctionDate),
                
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
        } catch (error) { 
            console.error(`DB Error for stock ${vehicle.stock}:`, error.message);
            errorCount++; 
        }
    }
    if (savedCount > 0) console.log(`💾 Saved ${savedCount} vehicles (Errors: ${errorCount})`);
    return { saved: savedCount, errors: errorCount };
};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfigurationInstance,
    maxConcurrency,
    requestHandlerTimeoutSecs: 7200, 
    launchContext: { launchOptions: { headless, args: ['--no-sandbox', '--disable-setuid-sandbox'] } },

    async requestHandler({ page, request }) {
        console.log(`📖 Processing: ${request.url}`);
        try {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 }); 
            await handleCookieConsent(page);
            if (!await waitForResults(page)) return;
            
            const totalCount = await getTotalAuctionsCount(page);
            stats.totalVehiclesOnSite = totalCount;
            console.log(`🎉 Total auctions found: ${totalCount}`);

            let currentPage = 1;
            
            if (savedState.lastPageProcessed > 1) {
                const resumePage = savedState.lastPageProcessed;
                console.log(`🔄 Resuming from page ${resumePage}...`);
                await fastForwardToPage(page, resumePage);
                currentPage = resumePage;
                console.log(`✅ Successfully resumed at page ${currentPage}`);
            }

            while (true) {
                await KeyValueStore.setValue(STATE_KEY, { lastPageProcessed: currentPage });

                console.log(`\n📄 === Scraping page ${currentPage} ===`);
                await page.waitForTimeout(1000);

                const vehiclesData = await extractVehicleDataFromList(page);
                
                if (vehiclesData.length === 0) {
                    console.log('⚠️ No vehicles found. Stopping pagination.');
                    break;
                }

                console.log(`✅ Found ${vehiclesData.length} vehicles.`);
                stats.vehiclesFound += vehiclesData.length;
                
                const { saved, errors } = await saveVehiclesToDatabase(vehiclesData);
                stats.dbSaved += saved;
                stats.dbErrors += errors;
                stats.pagesProcessed = currentPage;

                if (typeof stats.totalVehiclesOnSite === 'number' && stats.vehiclesFound >= stats.totalVehiclesOnSite) {
                    console.log(`🛑 Reached total count. Stopping.`);
                    break;
                }
                if (currentPage >= maxPages) {
                    console.log(`🛑 Max pages reached.`);
                    break;
                }

                const navigationSuccess = await navigateToPageNumber(page, currentPage + 1);
                if (navigationSuccess) {
                    currentPage++;
                } else {
                    console.log('🏁 End of pagination or navigation failed.');
                    break;
                }
            }
        } catch (error) {
            console.log(`❌ Main error:`, error.message);
            stats.errors++;
        }
    },
});

await crawler.addRequests(startUrls);
await crawler.run();

stats.endTime = new Date();
stats.duration = (stats.endTime - stats.startTime);

console.log('\n' + '='.repeat(50));
console.log('🎉 Crawling completed!');
console.log('📊 Statistics:', {
    pages: stats.pagesProcessed,
    found: stats.vehiclesFound,
    saved: stats.dbSaved,
    duration: `${Math.round(stats.duration / 1000)}s`,
});

await closeDatabase();
await Actor.exit();