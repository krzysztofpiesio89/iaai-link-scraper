import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

// DOBRA PRAKTYKA: Centralizacja selektorów.
const SELECTORS = {
    jsonData: 'script#ProductDetailsVM',
    unavailableMessage: '.message-panel__title:has-text("Vehicle Details Are Not Available")',
    captcha: 'iframe[src*="recaptcha"], .g-recaptcha, .h-captcha, #challenge-form, text=/verify you are human/i',
};

await Actor.init();

console.log('🚀 IAAI Vehicle Detail & Image Scraper (FINAL) - Starting...');

const {
    startUrls = [],
    proxyConfiguration,
} = await Actor.getInput() ?? {};

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

            if (await page.locator(SELECTORS.captcha).count() > 0) {
                throw new Error('CAPTCHA detected. Ensure you are using RESIDENTIAL proxies.');
            }

            await page.waitForSelector(`${SELECTORS.jsonData}, ${SELECTORS.unavailableMessage}`, {
                state: 'attached',
                timeout: 25000,
            });

            if (await page.locator(SELECTORS.unavailableMessage).count() > 0) {
                log.warning(`Vehicle at ${request.url} is no longer available. Skipping.`);
                state.vehiclesSkipped++;
                return;
            }

            const jsonData = await page.evaluate((selector) => {
                const scriptTag = document.querySelector(selector);
                return scriptTag ? JSON.parse(scriptTag.textContent) : null;
            }, SELECTORS.jsonData);

            if (!jsonData) {
                throw new Error('Could not find or parse ProductDetailsVM JSON data.');
            }

            const attributes = jsonData.inventoryView?.attributes || {};
            const auctionInfo = jsonData.auctionInformation || {};
            
            // --- NOWOŚĆ: POBIERANIE LINKÓW DO ZDJĘĆ ---
            const imageUrls = [];
            const imageKeys = jsonData.inventoryView?.imageDimensions?.keys || [];
            for (const image of imageKeys) {
                if (image.k) {
                    const imageUrl = `https://vis.iaai.com/resizer?imageKeys=${image.k}`;
                    imageUrls.push({ url: imageUrl }); // Formatujemy od razu dla Prisma
                }
            }

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
                images: imageUrls, // Dodajemy tablicę ze zdjęciami
            };

            await Dataset.pushData(vehicleData);
            log.info(`✅ Successfully extracted data for VIN: ${vehicleData.vin || attributes.StockNumber}`);
            state.vehiclesProcessed++;

        } catch (error) {
            state.vehiclesFailed++;
            log.error(`❌ Failed to process ${request.url}: ${error.message}`);
            
            const safeKey = request.url.replace(/[^a-zA-Z0-9-_.]/g, '_');
            const screenshotBuffer = await page.screenshot({ fullPage: true });
            await Actor.setValue(`ERROR-${safeKey}.png`, screenshotBuffer, { contentType: 'image/png' });
        }
    },
    
    failedRequestHandler: async ({ request, log }) => {
        const state = await crawler.useState();
        state.vehiclesFailed++;
        log.error(`💀 Request completely failed: ${request.url}`);
    }
});

const startTime = new Date();
await crawler.useState({ vehiclesProcessed: 0, vehiclesFailed: 0, vehiclesSkipped: 0 });

console.log('🏃‍♂️ Starting detail scraper...');
await crawler.run(startUrls);
console.log('✅ Detail scraper finished.');

const endTime = new Date();
const durationInSeconds = Math.round((endTime - startTime) / 1000);

const finalState = await crawler.useState();
const finalStats = {
    ...finalState,
    totalRequests: startUrls.length,
    duration: `${durationInSeconds}s`,
};

console.log('\n' + '='.repeat(50));
console.log('🎉 Scraping completed!');
console.log('📊 Final Statistics:', finalStats);
console.log('='.repeat(50));

await Actor.setValue('OUTPUT', finalStats);

await Actor.exit();