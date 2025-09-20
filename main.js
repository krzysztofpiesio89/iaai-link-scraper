import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

// DOBRA PRAKTYKA: Centralizacja selektorów.
const SELECTORS = {
    jsonData: 'script#ProductDetailsVM',
    unavailableMessage: '.message-panel__title:has-text("Vehicle Details Are Not Available")',
    captcha: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, #challenge-form, text=/verify you are human/i, text=/are you a robot/i',
};

await Actor.init();

console.log('🚀 IAAI Vehicle Detail Scraper (FINAL, PRODUCTION-READY) - Starting...');

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

        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

        if (await page.locator(SELECTORS.captcha).count() > 0) {
            throw new Error('CAPTCHA detected. Ensure you are using RESIDENTIAL proxies.');
        }

        await page.waitForSelector(`${SELECTORS.jsonData}, ${SELECTORS.unavailableMessage}`, {
            state: 'attached',
            timeout: 25000,
        });

        const isUnavailable = await page.locator(SELECTORS.unavailableMessage).count() > 0;
        if (isUnavailable) {
            log.warning(`Vehicle at ${request.url} is no longer available. Skipping.`);
            state.vehiclesSkipped++;
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
    },
    
    // DOBRA PRAKTYKA: Przeniesienie obsługi błędów do dedykowanego handlera.
    async failedRequestHandler({ request, log, page }) {
        const state = await crawler.useState();
        state.vehiclesFailed++;
        log.error(`💀 Request failed: ${request.url}. Saving debug info.`);

        // POPRAWKA: Tworzenie bezpiecznej nazwy klucza.
        const safeKey = request.url.replace(/[^a-zA-Z0-9-_.]/g, '_');
        
        const screenshotBuffer = await page.screenshot({ fullPage: true });
        await Actor.setValue(`ERROR-${safeKey}.png`, screenshotBuffer, { contentType: 'image/png' });
        
        const html = await page.content();
        await Actor.setValue(`ERROR-${safeKey}.html`, html, { contentType: 'text/html' });
    },
});

const startTime = new Date();
await crawler.useState({ vehiclesProcessed: 0, vehiclesFailed: 0, vehiclesSkipped: 0 });

console.log('🏃‍♂️ Starting crawler...');
await crawler.run(startUrls);
console.log('✅ Crawler finished.');

const endTime = new Date();
const durationInSeconds = Math.round((endTime - startTime) / 1000);

const finalState = await crawler.useState();
const finalStats = {
    ...finalState,
    totalRequests: startUrls.length,
    duration: `${durationInSeconds}s`,
};

