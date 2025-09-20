import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

console.log('🚀 IAAI Vehicle Detail Scraper (Best Practices Applied) - Starting...');

const {
    startUrls = [],
    proxyConfiguration,
} = await Actor.getInput() ?? {};

const SELECTORS = {
    jsonData: 'script#ProductDetailsVM',
    unavailableMessage: '.message-panel__title:has-text("Vehicle Details Are Not Available")',
};

// --- FUNKCJE POMOCNICZE ---
const parseNumber = (str) => {
    if (!str || typeof str !== 'string') return null;
    const cleaned = str.replace(/[$,\smiUSD]/g, '');
    const number = parseFloat(cleaned);
    return isNaN(number) ? null : number;
};

const parseDate = (dateStr) => {
    if (!dateStr) return null;
    try {
        return new Date(dateStr).toISOString();
    } catch (e) {
        console.warn(`Could not parse date: ${dateStr}`);
        return null;
    }
};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: await Actor.createProxyConfiguration(proxyConfiguration),
    maxConcurrency: 10,
    navigationTimeoutSecs: 120,

    async requestHandler({ page, request, log }) {
        const state = await crawler.useState();
        log.info(`🛠️ Processing: ${request.url}`);

        try {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

            const successSelector = SELECTORS.jsonData;
            const failureSelector = SELECTORS.unavailableMessage;

            await page.waitForSelector(`${successSelector}, ${failureSelector}`, {
                state: 'attached',
                timeout: 25000,
            });

            const isUnavailable = await page.locator(failureSelector).count() > 0;
            if (isUnavailable) {
                log.warning(`Vehicle at ${request.url} is no longer available. Skipping.`);
                state.vehiclesFailed++;
                return;
            }

            const jsonData = await page.evaluate((selector) => {
                const scriptTag = document.querySelector(selector);
                return scriptTag ? JSON.parse(scriptTag.textContent) : null;
            }, SELECTORS.jsonData);

            if (!jsonData) {
                throw new Error('Could not find or parse ProductDetailsVM JSON data on the page.');
            }

            const attributes = jsonData.inventoryView?.attributes || {};
            const auctionInfo = jsonData.auctionInformation || {};
            
            const vehicleData = {
                vehicleTitle: attributes.YearMakeModelSeries?.trim(),
                vin: attributes.VIN,
                stockNumber: attributes.StockNumber,
                mileage: parseNumber(attributes.ODOValue),
                primaryDamage: attributes.PrimaryDamageDesc,
                secondaryDamage: attributes.SecondaryDamageDesc,
                estimatedRetailValue: parseNumber(jsonData.inventory?.providerACV),
                bodyStyle: attributes.BodyStyleName,
                engine: attributes.EngineSize || attributes.EngineInformation,
                transmission: attributes.Transmission,
                fuelType: attributes.FuelTypeDesc,
                cylinders: attributes.CylindersDesc,
                hasKeys: attributes.Keys?.toLowerCase() === 'true',
                driveLineType: attributes.DriveLineTypeDesc,
                saleDocument: `${attributes.Title} (${attributes.TitleStateName})`,
                auctionLocation: attributes.BranchName,
                saleDate: parseDate(auctionInfo.prebidInformation?.liveDate),
                auctionItemNumber: attributes.Slot,
                currentBid: parseNumber(auctionInfo.biddingInformation?.highBidAmount),
                buyNowPrice: parseNumber(auctionInfo.biddingInformation?.buyNowPrice),
                sourceUrl: request.url,
            };

            await Dataset.pushData(vehicleData);
            log.info(`✅ Successfully extracted data for VIN: ${vehicleData.vin || attributes.StockNumber}`);
            state.vehiclesProcessed++;

        } catch (error) {
            state.vehiclesFailed++;
            log.error(`❌ Failed to process ${request.url}: ${error.message}`);
            
            const screenshotBuffer = await page.screenshot({ fullPage: true });
            const html = await page.content();
            
            await Actor.setValue(`ERROR-${request.uniqueKey}.png`, screenshotBuffer, { contentType: 'image/png' });
            await Actor.setValue(`ERROR-${request.uniqueKey}.html`, html, { contentType: 'text/html' });
            
            log.warning(`📸 Screenshot and HTML saved for debugging. Check the Key-Value Store.`);
        }
    },
    failedRequestHandler: async ({ request, log }) => {
        const state = await crawler.useState();
        state.vehiclesFailed++;
        log.error(`💀 Request completely failed and will not be retried: ${request.url}`);
    }
});

const startTime = new Date();
await crawler.useState({ vehiclesProcessed: 0, vehiclesFailed: 0 });

// POPRAWKA: Użycie `console.log` w globalnym zakresie
console.log('🏃‍♂️ Starting crawler...');
await crawler.run(startUrls);
// POPRAWKA: Użycie `console.log` w globalnym zakresie
console.log('✅ Crawler finished.');

const endTime = new Date();
const durationInSeconds = Math.round((endTime - startTime) / 1000);

const finalState = await crawler.useState();
const finalStats = {
    ...finalState,
    totalRequests: startUrls.length,
    duration: `${durationInSeconds}s`,
};

console.log('\n' + '='.repeat(50));
console.log('🎉 Crawling completed!');
console.log('📊 Final Statistics:', finalStats);
console.log('='.repeat(50));

await Actor.setValue('OUTPUT', finalStats);

await Actor.exit();