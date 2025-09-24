import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();
console.log('🚀 IAAI Full Data from List Scraper (Stealth & Proven Logic) - Starting...');

const input = await Actor.getInput() ?? {};
const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType' }],
    maxPages = 50,
    proxyConfiguration,
    headless = true,
} = input;

const proxyConfigurationInstance = await Actor.createProxyConfiguration(proxyConfiguration);
const dataset = await Dataset.open();

const startTime = new Date();
const stats = { pagesProcessed: 0, vehiclesFound: 0, errors: 0, startTime };

// --- ZAKTUALIZOWANA FUNKCJA DO EKSTRAKCJI DANYCH ---
const extractVehicleDataFromList = async (page) => {
    return page.evaluate(() => {
        const results = [];
        document.querySelectorAll('div.table-row.table-row-border').forEach(row => {
            try {
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
    const captchaSelectors = ['iframe[src*="recaptcha"]', '.g-recaptcha', '.h-captcha', '.cf-challenge-form', '#challenge-form', 'h1:has-text("Verifying you are human")'];
    for (const sel of captchaSelectors) {
        if (await page.locator(sel).count() > 0) return true;
    }
    return false;
};

const handleCookieConsent = async (page) => {
    try {
        const cookieButton = page.locator('#truste-consent-button, button[class*="cookie"]').first();
        if (await cookieButton.isVisible({ timeout: 3000 })) {
            console.log('🍪 Accepting cookie consent...');
            await cookieButton.click();
        }
    } catch (error) { /* Ignore */ }
};

const waitForResults = async (page) => { /* ... bez zmian, można usunąć jeśli nieużywane wprost ... */ };
const navigateToPageNumber = async (page, pageNumber) => { /* ... Twój nienaruszony kod ... */ };
const navigateToNextTenPages = async (page) => { /* ... Twój nienaruszony kod ... */ };

const crawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfigurationInstance,
    maxConcurrency,
    requestHandlerTimeoutSecs: 300,
    navigationTimeoutSecs: 120,
    launchContext: {
        launchOptions: { headless, args: ['--no-sandbox'] }
    },
    preNavigationHooks: [
        async ({ page }) => {
            await page.setExtraHTTPHeaders({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            });
            await page.setViewportSize({ width: 1920, height: 1080 });
        },
    ],
    async requestHandler({ page, request }) {
        console.log(`📖 Processing: ${request.url}`);
        
        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        if (await checkForCaptcha(page)) {
            stats.errors++;
            throw new Error('CAPTCHA detected. Use RESIDENTIAL proxies.');
        }

        await handleCookieConsent(page);
        
        // Czekamy na załadowanie wyników przed rozpoczęciem pętli
        await page.waitForSelector('div.table-row-border', { timeout: 30000 });

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
    },
    failedRequestHandler: async ({ request, page }) => {
        stats.errors++;
        console.error(`💀 Request failed: ${request.url}. Saving debug info.`);
        const safeKey = request.url.replace(/[^a-zA-Z0-9-_.]/g, '_');
        const screenshotBuffer = await page.screenshot({ fullPage: true });
        await Actor.setValue(`ERROR-${safeKey}.png`, screenshotBuffer, { contentType: 'image/png' });
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