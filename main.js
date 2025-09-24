import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

// Initialize the Actor
await Actor.init();
console.log('🚀 IAAI Full Data from List Scraper (Proven Pagination Logic) - Starting...');

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

// POPRAWKA: Przeniesienie `startTime` tutaj, aby była globalnie dostępna
const startTime = new Date();
const stats = { pagesProcessed: 0, vehiclesFound: 0, errors: 0, startTime };

// --- ZAKTUALIZOWANA FUNKCJA DO EKSTRAKCJI PEŁNYCH DANYCH Z LISTY ---
const extractVehicleDataFromList = async (page) => {
    return page.evaluate(() => {
        const results = [];
        document.querySelectorAll('div.table-row.table-row-border').forEach(row => {
            try {
                // Funkcja pomocnicza do pobierania tekstu z atrybutu title, jest bardziej niezawodna
                const getValueByTitle = (label) => {
                    const element = row.querySelector(`[title^="${label}"]`);
                    return element ? element.textContent.trim() : null;
                };

                const linkElement = row.querySelector('h4.heading-7 a');
                const imageElement = row.querySelector('.table-cell--image img');
                if (!linkElement || !imageElement) return;

                const title = linkElement.textContent.trim();
                const yearMatch = title.match(/^\d{4}/);
                const year = yearMatch ? yearMatch[0] : null;
                const make = year ? title.substring(5).split(' ')[0] : null;
                const model = make ? title.substring(5 + (make?.length || 0)).trim() : title;

                const buyNowLink = Array.from(row.querySelectorAll('a')).find(a => a.textContent.includes('Buy Now'));
                const preBidButton = row.querySelector('.btn--pre-bid');

                const vehicleData = {
                    detailUrl: new URL(linkElement.getAttribute('href'), location.origin).href,
                    imageUrl: imageElement.getAttribute('data-src') || imageElement.getAttribute('src'),
                    year,
                    make,
                    model,
                    stockNumber: getValueByTitle('Stock #:'),
                    titleStatus: getValueByTitle('Title/Sale Doc:'),
                    primaryDamage: getValueByTitle('Primary Damage:'),
                    odometer: getValueByTitle('Odometer:'),
                    startCode: row.querySelector('.badge')?.textContent.trim() || null,
                    airbags: getValueByTitle('Airbags:'),
                    keyStatus: getValueByTitle('Key :'),
                    engine: getValueByTitle('Engine:'),
                    fuelType: getValueByTitle('Fuel Type:'),
                    cylinders: getValueByTitle('Cylinder:'),
                    vin: row.querySelector('[name*="******"]')?.getAttribute('name') || null,
                    branchLocation: row.querySelector('a[href*="/locations/"]')?.textContent.trim() || null,
                    laneRun: getValueByTitle('Lane/Run#:'),
                    aisleStall: getValueByTitle('Aisle/Stall:'),
                    market: getValueByTitle('Market:'),
                    acv: getValueByTitle('ACV:'),
                    auctionDate: row.querySelector('.data-list__value--action')?.textContent.trim().split('\n')[0].trim() || null,
                    biddingStatus: buyNowLink ? buyNowLink.textContent.trim() : (preBidButton ? preBidButton.textContent.trim() : 'N/A'),
                };
                results.push(vehicleData);
            } catch (e) {
                console.warn('Could not process a vehicle row:', e.message);
            }
        });
        return results;
    });
};

// ## ORYGINALNE FUNKCJE POMOCNICZE (BEZ ZMIAN) ##
const checkForCaptcha = async (page) => {
    const captchaSelectors = ['iframe[src*="recaptcha"]', '.g-recaptcha', '.h-captcha', '.cf-challenge-form', '#challenge-form'];
    for (const sel of captchaSelectors) {
        if (await page.isVisible(sel, { timeout: 2000 })) return true;
    }
    const title = (await page.title()).toLowerCase();
    const pageText = (await page.evaluate(() => document.body?.innerText?.toLowerCase() || ''));
    return ['verify you are human', 'robot', 'captcha', 'challenge'].some(k => title.includes(k) || pageText.includes(k));
};

const handleCookieConsent = async (page) => {
    try {
        const cookieSelectors = [
            '#truste-consent-button',
            'button[class*="cookie"]',
            'button[class*="consent"]',
            '.cookie-banner button',
            '[id*="accept-cookies"]'
        ];
        for (const selector of cookieSelectors) {
            const button = page.locator(selector).first();
            if (await button.isVisible({ timeout: 2000 })) {
                console.log('🍪 Accepting cookie consent...');
                await button.click();
                return true;
            }
        }
    } catch (error) {
        // Ignore errors
    }
    return false;
};

const waitForResults = async (page, timeout = 15000) => {
    console.log('⏳ Waiting for search results to load...');
    try {
        await page.waitForSelector('a[href^="/VehicleDetail/"]', { timeout });
        console.log('✅ Vehicle detail links found');
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
        if (await pageButton.count() > 0 && await pageButton.isEnabled()) {
            console.log(`🔢 Clicking page number button: ${pageNumber}`);
            const firstLinkLocator = page.locator('a[href^="/VehicleDetail/"]').first();
            const hrefBeforeClick = await firstLinkLocator.getAttribute('href');
            if (!hrefBeforeClick) {
                console.log('⚠️ Could not find a reference href to track navigation.');
                return false;
            }
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
            if (!hrefBeforeClick) {
                console.log('⚠️ Could not find a reference href to track navigation.');
                return false;
            }
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
    maxRequestsPerCrawl,
    requestHandlerTimeoutSecs: 300,
    navigationTimeoutSecs: 120,
    launchContext: {
        launchOptions: {
            headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
        },
        useChrome: true,
    },
    async requestHandler({ page, request }) {
        console.log(`📖 Processing: ${request.url}`);
        try {
            await page.setViewportSize({ width: 1920, height: 1080 });
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            if (await checkForCaptcha(page)) {
                stats.errors++;
                throw new Error('CAPTCHA detected, cannot proceed.');
            }

            await handleCookieConsent(page);
            await waitForResults(page);

            let currentPage = 1;
            while (currentPage <= maxPages) {
                console.log(`\n📄 === Scraping page ${currentPage} ===`);
                
                const vehiclesData = await extractVehicleDataFromList(page);
                console.log(`✅ Found data for ${vehiclesData.length} vehicles on page ${currentPage}`);

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
stats.duration = (stats.endTime - startTime);
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