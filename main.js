import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();
console.log('🚀 IAAI Enhanced Data Scraper (v5 - Total Count Logic) - Starting...');

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

const stats = { pagesProcessed: 0, vehiclesFound: 0, errors: 0, startTime: new Date(), totalExpected: 0 };

// --- FUNKCJA DO POBRANIA CAŁKOWITEJ LICZBY OGŁOSZEŃ ---
const getTotalVehiclesCount = async (page) => {
    try {
        console.log('🔢 Getting total vehicles count...');
        const totalElement = await page.locator('label.label--total#headerTotalAmount').first();
        
        if (await totalElement.count() > 0) {
            const totalText = await totalElement.textContent();
            // Usuń przecinki i konwertuj na liczbę
            const total = parseInt(totalText.replace(/,/g, '').trim(), 10);
            console.log(`📊 Total vehicles available: ${total.toLocaleString()}`);
            return total;
        }
        
        console.log('⚠️ Could not find total count element');
        return 0;
    } catch (error) {
        console.log('⚠️ Error getting total count:', error.message);
        return 0;
    }
};

// --- FUNKCJA DO EKSTRAKCJI DANYCH (z logiką rozdzielającą tytuł i datą aukcji) ---
const extractVehicleDataFromList = async (page) => {
    return page.evaluate(() => {
        const results = [];
        document.querySelectorAll('div.table-row.table-row-border').forEach(row => {
            try {
                // --- Funkcje pomocnicze do pobierania tekstu ---
                const getTextByTitle = (prefix) => {
                    const element = row.querySelector(`span[title^="${prefix}"]`);
                    return element ? element.textContent.trim() : null;
                };
                
                const getText = (selector) => {
                    const element = row.querySelector(selector);
                    return element ? element.textContent.trim() : null;
                };

                // --- Podstawowe informacje ---
                const linkElement = row.querySelector('h4.heading-7 a');
                if (!linkElement) return;

                const detailUrl = new URL(linkElement.getAttribute('href'), location.origin).href;
                const fullTitle = linkElement.textContent.trim();
                const imageUrl = row.querySelector('.table-cell--image img')?.getAttribute('data-src') || row.querySelector('.table-cell--image img')?.getAttribute('src');

                // --- Rozdzielanie tytułu na rok, markę, model i wersję ---
                const yearMatch = fullTitle.match(/^\d{4}/);
                const year = yearMatch ? yearMatch[0] : null;

                let make = null;
                let model = null;
                let version = null;

                if (year) {
                    const restOfTitle = fullTitle.substring(year.length).trim();
                    const parts = restOfTitle.split(' ');
                    make = parts.shift() || null; 
                    model = parts.shift() || null;
                    version = parts.join(' ').trim();
                }

                // --- Ekstrakcja pozostałych danych ---
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
                const engineInfo = getTextByTitle("Engine:");
                const fuelType = getTextByTitle("Fuel Type:");
                const cylinders = getTextByTitle("Cylinder:");
                const origin = getText('span[title^="Branch:"] a');
                const engineStatus = getText('.badge');
                
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
                    mileage,
                    engineStatus,
                    origin,
                    vin,
                    engineInfo,
                    fuelType,
                    cylinders,
                    bidPrice,
                    buyNowPrice,
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

// *** FUNKCJA POMOCNICZA DO CZEKANIA NA ZNIKNIĘCIE LOADERA ***
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

// --- FUNKCJA CZEKAJĄCA NA ZAŁADOWANIE WYNIKÓW ---
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

// --- FUNKCJA DO NAWIGACJI DO NASTĘPNYCH 10 STRON ---
const navigateToNextTenPages = async (page) => {
    try {
        const nextTenButton = page.locator('button.btn-next-10');
        if (await nextTenButton.count() > 0 && await nextTenButton.isEnabled()) {
            console.log('⏭️ Clicking "Next 10 Pages"...');
            
            const firstLinkLocator = page.locator('a[href^="/VehicleDetail/"]').first();
            const hrefBeforeClick = await firstLinkLocator.getAttribute('href');

            await waitForLoaderToDisappear(page);
            await nextTenButton.click();
            
            console.log(`⏳ Waiting for content to update...`);
            await page.waitForFunction((expectedOldHref) => {
                const currentFirstLink = document.querySelector('a[href^="/VehicleDetail/"]');
                return currentFirstLink && currentFirstLink.getAttribute('href') !== expectedOldHref;
            }, hrefBeforeClick, { timeout: 20000 });
            console.log('✅ Successfully navigated to the next set of pages.');
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
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

            // NOWE: Pobierz całkowitą liczbę ogłoszeń na początku
            const totalVehicles = await getTotalVehiclesCount(page);
            stats.totalExpected = totalVehicles;

            let currentPage = 1;
            
            while (true) {
                console.log(`\n📄 === Scraping page ${currentPage} ===`);
                console.log(`📊 Progress: ${stats.vehiclesFound}/${totalVehicles} vehicles (${((stats.vehiclesFound/totalVehicles)*100).toFixed(1)}%)`);

                const vehiclesData = await extractVehicleDataFromList(page);
                console.log(`✅ Found ${vehiclesData.length} vehicles on page ${currentPage}`);

                // WARUNEK 1: Brak pojazdów na stronie
                if (vehiclesData.length === 0) {
                   console.log('⚠️ No vehicles found on this page. Stopping pagination.');
                   break;
                }
                
                stats.vehiclesFound += vehiclesData.length;
                await dataset.pushData(vehiclesData);
                stats.pagesProcessed = currentPage;

                // WARUNEK 2: Osiągnięto całkowitą liczbę ogłoszeń (z niewielkim marginesem)
                if (totalVehicles > 0 && stats.vehiclesFound >= totalVehicles) {
                    console.log(`🎯 Reached total expected vehicles: ${stats.vehiclesFound}/${totalVehicles}`);
                    console.log('✅ All vehicles have been scraped!');
                    break;
                }

                // --- LOGIKA NAWIGACJI ---
                const nextPageNumber = currentPage + 1;
                let navigationSuccess = await navigateToPageNumber(page, nextPageNumber);

                if (!navigationSuccess) {
                    console.log(`🔢 Button for page ${nextPageNumber} not found. Attempting to jump to the next 10 pages.`);
                    navigationSuccess = await navigateToNextTenPages(page);
                }

                // WARUNEK 3: Brak możliwości nawigacji
                if (navigationSuccess) {
                    currentPage++;
                } else {
                    console.log('🏁 No more navigation buttons available. This is the true end of pagination.');
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
    totalExpected: stats.totalExpected,
    vehiclesFound: stats.vehiclesFound,
    completeness: stats.totalExpected > 0 ? `${((stats.vehiclesFound/stats.totalExpected)*100).toFixed(1)}%` : 'N/A',
    errors: stats.errors,
    duration: `${Math.round(stats.duration / 1000)}s`,
});
console.log('='.repeat(50));

await Actor.exit();