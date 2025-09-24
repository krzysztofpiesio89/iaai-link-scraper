import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();
console.log('🚀 IAAI Advanced Data Scraper (with Modal Image Extraction) - Starting...');

const input = await Actor.getInput() ?? {};
const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType' }],
    maxRequestsPerCrawl = 1000,
    maxConcurrency = 1,
    proxyConfiguration,
    headless = true,
    debugMode = false,
    maxPages = 50
} = input;

const proxyConfigurationInstance = await Actor.createProxyConfiguration(proxyConfiguration);
const dataset = await Dataset.open();

const stats = { pagesProcessed: 0, vehiclesFound: 0, errors: 0, startTime: new Date() };

// --- FUNKCJA DO EKSTRAKCJI STATYCZNYCH DANYCH Z LISTY (BEZ ZMIAN) ---
const extractVehicleDataFromList = async (page) => {
    return page.evaluate(() => {
        const results = [];
        document.querySelectorAll('div.table-row.table-row-border').forEach(row => {
            try {
                const linkElement = row.querySelector('h4.heading-7 a');
                const imageElement = row.querySelector('.table-cell--image img');
                if (!linkElement || !imageElement) return;

                const title = linkElement.textContent.trim();
                const yearMatch = title.match(/^\d{4}/);
                
                const vehicleData = {
                    detailUrl: new URL(linkElement.getAttribute('href'), location.origin).href,
                    imageUrl: imageElement.getAttribute('data-src') || imageElement.getAttribute('src'),
                    title: title,
                    year: yearMatch ? yearMatch[0] : null,
                    make: yearMatch ? title.substring(5).split(' ')[0] : null,
                    model: yearMatch ? title.substring(5 + (title.substring(5).split(' ')[0]).length).trim() : title,
                };

                const keyMap = {
                    'Stock #:': 'stock', 'VIN:': 'vin', 'Odometer:': 'odometer',
                    'Start Code:': 'startCode', 'Key:': 'key', 'Engine:': 'engine',
                    'Cylinders:': 'cylinders', 'Fuel Type:': 'fuelType', 'Location:': 'location',
                    'Sale Document:': 'saleDocument', 'ACV:': 'acv',
                };

                row.querySelectorAll('.data-list__item').forEach(item => {
                    const labelElement = item.querySelector('.data-list__label');
                    const valueElement = item.querySelector('.data-list__value');

                    if (labelElement && valueElement) {
                        const labelText = labelElement.textContent.trim();
                        const key = keyMap[labelText];
                        if (key) {
                            vehicleData[key] = valueElement.textContent.trim();
                        }
                    }
                });

                const tags = [];
                const primaryDataCell = row.querySelector('.table-cell--data-1');
                if (primaryDataCell) {
                    primaryDataCell.querySelectorAll('.data-list__value--damage').forEach(tagEl => {
                        const text = tagEl.textContent.trim();
                        if (text) tags.push(text);
                    });
                }
                vehicleData.conditionTags = tags.join(' | ');

                const auctionCell = row.querySelector('.table-cell--data-3');
                if (auctionCell) {
                    const auctionDateEl = auctionCell.querySelector('[id^="auctionDate"]');
                    const bidStatusEl = auctionCell.querySelector('.btn--tertiary-light');
                    const buyNowPriceEl = auctionCell.querySelector('.btn--primary-cta');
                    if (auctionDateEl) vehicleData.auctionDate = auctionDateEl.textContent.trim();
                    if (bidStatusEl) vehicleData.biddingStatus = bidStatusEl.textContent.trim();
                    if (buyNowPriceEl) vehicleData.buyNowPrice = buyNowPriceEl.textContent.replace(/Buy Now/i, '').trim();
                }
                
                results.push(vehicleData);
            } catch (e) {
                console.warn('Could not process a vehicle row:', e.message);
            }
        });
        return results;
    });
};

// --- FUNKCJE POMOCNICZE (BEZ ZMIAN) ---
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
    requestHandlerTimeoutSecs: 600, // Zwiększony timeout na obsługę strony
    navigationTimeoutSecs: 120,
    launchContext: { launchOptions: { headless, args: ['--no-sandbox'] } },

    // --- NOWY, ROZBUDOWANY REQUEST HANDLER ---
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

                // Krok 1: Pobierz wszystkie statyczne dane z widoku listy
                const staticVehiclesData = await extractVehicleDataFromList(page);
                
                if (staticVehiclesData.length === 0) {
                    console.log('⚠️ No vehicles found on this page, stopping pagination.');
                    break;
                }

                // Krok 2: Pobierz lokatory do wierszy, aby móc na nich wykonywać akcje
                const vehicleRows = await page.locator('div.table-row.table-row-border').all();
                
                const itemsToProcessCount = Math.min(staticVehiclesData.length, vehicleRows.length);
                console.log(`🔎 Found ${itemsToProcessCount} vehicles to process on this page.`);

                // Krok 3: Przetwórz każdy pojazd, aby pobrać dodatkowe zdjęcia
                const pageResults = [];
                for (let i = 0; i < itemsToProcessCount; i++) {
                    const vehicleData = staticVehiclesData[i];
                    const row = vehicleRows[i];
                    console.log(`  -> Processing vehicle ${i + 1}/${itemsToProcessCount}: ${vehicleData.title}`);

                    try {
                        const viewImagesButton = row.locator('button.btn-allimages');
                        if (await viewImagesButton.count() > 0) {
                            console.log('     - Clicking "View All Images" button...');
                            await viewImagesButton.scrollIntoViewIfNeeded();
                            await viewImagesButton.click();

                            await page.waitForSelector('#image_360Modal.show', { state: 'visible', timeout: 15000 });
                            console.log('     - Modal opened.');
                            
                            await page.waitForSelector('#hdnDimensions', { state: 'attached', timeout: 10000 });

                            const jsonText = await page.locator('#hdnDimensions').textContent();
                            const imageData = JSON.parse(jsonText);
                            
                            // Tworzenie URLi do obrazów w wysokiej rozdzielczości
                            const allImageUrls = imageData.keys?.map(keyObj => `https://vis.iaai.com/resizer?imageKeys=${keyObj.K}&width=1920`) || [];
                            const videoUrls = imageData.Videos?.map(video => video.URL) || [];
                            
                            vehicleData.allImageUrls = allImageUrls;
                            vehicleData.videoUrls = videoUrls;
                            console.log(`     - ✅ Extracted ${allImageUrls.length} images and ${videoUrls.length} videos.`);
                            
                            console.log('     - Closing modal...');
                            await page.locator('#image_360Modal button[data-dismiss="modal"]').first().click();
                            await page.waitForSelector('#image_360Modal.show', { state: 'hidden', timeout: 10000 });
                            await page.waitForTimeout(250); // Krótka pauza na ustabilizowanie UI
                        } else {
                            console.log('     - "View All Images" button not found.');
                            vehicleData.allImageUrls = [];
                            vehicleData.videoUrls = [];
                        }
                    } catch (e) {
                        console.warn(`     - ❌ Error processing image modal for ${vehicleData.title}: ${e.message}`);
                        vehicleData.allImageUrls = vehicleData.allImageUrls || [];
                        vehicleData.videoUrls = vehicleData.videoUrls || [];
                        // Próba odzyskania, jeśli modal utknął
                        if (await page.locator('#image_360Modal.show').isVisible({ timeout: 1000 })) {
                            console.log('     - Modal seems stuck. Reloading page to recover.');
                            await page.reload({ waitUntil: 'domcontentloaded' });
                            break; // Przerwij pętlę dla tej strony po przeładowaniu
                        }
                    }
                    pageResults.push(vehicleData);
                }

                if (pageResults.length > 0) {
                    console.log(`💾 Pushing ${pageResults.length} vehicle records from page ${currentPage} to the dataset.`);
                    await dataset.pushData(pageResults);
                    stats.vehiclesFound += pageResults.length;
                }
                
                stats.pagesProcessed = currentPage;

                if (currentPage >= maxPages) {
                    console.log(`🏁 Reached maxPages limit of ${maxPages}. Stopping.`);
                    break;
                }
                
                // Logika paginacji (bez zmian)
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