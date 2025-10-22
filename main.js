import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();
console.log('🚀 IAAI Enhanced Data Scraper (v4 - Title Split Logic) - Starting...');

const input = await Actor.getInput() ?? {};
const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType' }],
    maxRequestsPerCrawl = 1000,
    maxConcurrency = 1,
    proxyConfiguration,
    headless = true,
    debugMode = false,
    maxPages = 999
} = input;

const proxyConfigurationInstance = await Actor.createProxyConfiguration(proxyConfiguration);
const dataset = await Dataset.open();

const stats = { pagesProcessed: 0, vehiclesFound: 0, errors: 0, startTime: new Date() };

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

                // --- NOWA LOGIKA: Rozdzielanie tytułu na rok, markę, model i wersję ---
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
                // --- KONIEC NOWEJ LOGIKI ---

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
                
                // <<< ---- NOWA LINIA: Pobieranie daty aukcji ---- >>>
                const auctionDate = getText('.data-list__value--action');
                const is360 = !!row.querySelector('span.media_360_view');
                const videoUrl = stock ? `https://mediastorageaccountprod.blob.core.windows.net/media/${stock}_VES-100_1` : null;

                results.push({
                    stock,
                    year,
                    make,
                    model,
                    version,
                    // <<< ---- DODAJ TUTAJ: Dodanie daty do obiektu wynikowego ---- >>>
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
        if (await pageButton.count() > 0) {
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
        console.log(`❌ Failed to click page ${pageNumber}: ${error.message}`);
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
        console.log(`❌ Failed to click "Next 10 Pages": ${error.message}`);
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

            let currentPage = 1;
            while (currentPage <= maxPages) {
                console.log(`\n📄 === Scraping page ${currentPage} ===`);

                const vehiclesData = await extractVehicleDataFromList(page);
                console.log(`✅ Found ${vehiclesData.length} vehicles on page ${currentPage}`);

                if (vehiclesData.length > 0) {
                    stats.vehiclesFound += vehiclesData.length;
                    await dataset.pushData(vehiclesData);
                } else {
                   console.log('⚠️ No vehicles found on this page, stopping pagination.');
                   break;
                }
                
                stats.pagesProcessed = currentPage;

                if (currentPage >= maxPages) {
                    console.log(`🏁 Reached maxPages limit of ${maxPages}. Stopping.`);
                    break;
                }
                
                const nextPageNumber = currentPage + 1;
                let navigationSuccess = await navigateToPageNumber(page, nextPageNumber);

                if (!navigationSuccess) {
                    console.log(`🔢 Button for page ${nextPageNumber} not found. Attempting to jump to the next 10 pages.`);
                    navigationSuccess = await navigateToNextTenPages(page);
                }

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
    vehiclesFound: stats.vehiclesFound,
    errors: stats.errors,
    duration: `${Math.round(stats.duration / 1000)}s`,
});
console.log('='.repeat(50));

await Actor.exit();