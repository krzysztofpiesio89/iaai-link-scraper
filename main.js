import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { prisma, testConnection, upsertCar, closeDatabase, getStats, showConnectionInfo } from './prisma.js';

await Actor.init();
console.log('🚀 IAAI Enhanced Data Scraper (V8 - Pagination Fix) - Starting...');

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

const parseDate = (dateString) => {
    if (!dateString || typeof dateString !== 'string') return null;
    const cleaned = dateString.trim();
    const directDate = new Date(cleaned);
    if (!isNaN(directDate.getTime())) return directDate;
    
    // Uproszczone parsowanie dat
    const match = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match) {
        const m = parseInt(match[1]);
        const d = parseInt(match[2]);
        const y = parseInt(match[3]);
        if (m > 0 && d > 0 && y > 2000) return new Date(y, m - 1, d);
    }
    return null;
};

const waitForLoaderToDisappear = async (page, timeout = 25000) => {
    try {
        // Czekamy na główny loader
        await page.waitForSelector('.circle-loader-shape', { state: 'hidden', timeout });
        // Czekamy też na ewentualny overlay blokujący (częste przy paginacji AJAX)
        await page.waitForSelector('.blockUI.blockOverlay', { state: 'hidden', timeout: 5000 }).catch(() => {});
    } catch (e) {
        console.log('⚠️ Loader wait warning (continuing).');
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

// --- NAPRAWIONA FUNKCJA DO NAWIGACJI PO STRONACH ---
const navigateToPageNumber = async (page, targetPageNumber) => {
    try {
        await waitForLoaderToDisappear(page);
        
        console.log(`🔢 Attempting to navigate to page ${targetPageNumber}`);
        
        // STRATEGIA 1: Bezpośredni przycisk numeru strony (jeśli jest widoczny)
        // Np. przycisk "91" jeśli właśnie załadowaliśmy nowy blok
        const specificPageBtn = page.locator(`button#PageNumber${targetPageNumber}`);
        if (await specificPageBtn.isVisible({ timeout: 1000 }) && await specificPageBtn.isEnabled()) {
            console.log(`✅ Clicking direct page button: ${targetPageNumber}`);
            await specificPageBtn.click();
            await waitForLoaderToDisappear(page);
            return true;
        }

        // STRATEGIA 2: Obsługa "kolejnej dziesiątki" (Next 10 Pages)
        // To naprawia problem przy stronie 90, 100 itd.
        // Szukamy przycisku, który ma klasę btn-next-10
        const nextTenBtn = page.locator('button.btn-next-10').first();
        const isNextTenVisible = await nextTenBtn.isVisible().catch(() => false);
        const isNextTenEnabled = await nextTenBtn.isEnabled().catch(() => false);

        // Sprawdź, czy bezpośredni numer strony NIE istnieje, ale przycisk "Next 10" istnieje.
        // Jest to kluczowe w momencie przejścia np. z 90 na 91.
        if (!await specificPageBtn.isVisible() && isNextTenVisible && isNextTenEnabled) {
             console.log(`⏭️ Direct button missing. Clicking "Next 10 Pages" (btn-next-10) to load next block...`);
             await nextTenBtn.click();
             
             // Po kliknięciu "Next 10" musimy poczekać, aż pojawi się nowy blok numerów
             await page.waitForTimeout(2000); // Krótka pauza na start requestu
             await waitForLoaderToDisappear(page);
             
             // Po przeładowaniu bloku, musimy kliknąć konkretny numer, jeśli nie jesteśmy na nim automatycznie
             // Często IAAI po kliknięciu Next 10 ustawia aktywną pierwszą stronę z nowej dziesiątki (np. 91),
             // ale dla pewności sprawdzamy.
             const newSpecificBtn = page.locator(`button#PageNumber${targetPageNumber}`);
             if (await newSpecificBtn.isVisible()) {
                 // Sprawdź, czy nie jest już aktywny
                 const classAttr = await newSpecificBtn.getAttribute('class');
                 if (!classAttr.includes('active')) {
                     console.log(`   Clicking newly appeared button ${targetPageNumber}`);
                     await newSpecificBtn.click();
                     await waitForLoaderToDisappear(page);
                 }
             }
             return true;
        }

        // STRATEGIA 3: Zwykły przycisk "Next" (btn-next)
        // Używamy go jako fallback, jeśli nie jesteśmy na granicy dziesiątek
        const nextButton = page.locator('button.btn-next').first();
        if (await nextButton.isVisible() && await nextButton.isEnabled()) {
            console.log(`➡️ Clicking Standard Next button`);
            await nextButton.click();
            await waitForLoaderToDisappear(page);
            return true;
        }
        
        console.log(`⚠️ Navigation failed. Target: ${targetPageNumber}. No valid buttons found.`);
        return false;

    } catch (error) {
        console.error(`❌ Navigation error to page ${targetPageNumber}:`, error.message);
        return false;
    }
};

// --- FUNKCJA DO ZAPISYWANIA DO BAZY DANYCH ---
const saveVehiclesToDatabase = async (vehiclesData) => {
    let savedCount = 0;
    let errorCount = 0;
    
    for (const vehicle of vehiclesData) {
        try {
            if (!vehicle.stock) continue;
            
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
                auctionDate: vehicle.auctionDate ? parseDate(vehicle.auctionDate) : null,
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
            errorCount++;
        }
    }
    
    if (savedCount > 0) console.log(`💾 Saved ${savedCount} vehicles (Errors: ${errorCount})`);
    return { saved: savedCount, errors: errorCount };
};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfigurationInstance,
    maxConcurrency,
    requestHandlerTimeoutSecs: 300,
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
            
            while (true) {
                console.log(`\n📄 === Scraping page ${currentPage} ===`);

                // Poczekaj chwilę na stabilizację DOM przed skrobaniem
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

                // Sprawdzenie limitów
                if (typeof stats.totalVehiclesOnSite === 'number' && stats.vehiclesFound >= stats.totalVehiclesOnSite) {
                    console.log(`🛑 Reached total count. Stopping.`);
                    break;
                }
                if (currentPage >= maxPages) {
                    console.log(`🛑 Max pages reached.`);
                    break;
                }

                // NAWIGACJA
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