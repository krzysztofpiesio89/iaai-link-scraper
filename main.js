import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

// DOBRA PRAKTYKA: Centralizacja selektorów ułatwia konserwację kodu.
const SELECTORS = {
    jsonData: 'script#ProductDetailsVM',
    unavailableMessage: '.message-panel__title:has-text("Vehicle Details Are Not Available")',
};

await Actor.init();

console.log('🚀 IAAI Vehicle Detail Scraper (Best Practices Applied) - Starting...');

const {
    startUrls = [],
    proxyConfiguration,
} = await Actor.getInput() ?? {};

// --- FUNKCJE POMOCNICZE (bez zmian) ---
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

    // DOBRA PRAKTYKA: Użycie log z kontekstu zamiast console.log
    async requestHandler({ page, request, log }) {
        // DOBRA PRAKTYKA: Użycie stanu zarządzanego przez crawler
        const state = await crawler.useState();
        log.info(`🛠️ Processing: ${request.url}`);

        try {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

            // Czekamy JEDNOCZEŚNIE na jeden z dwóch możliwych elementów
            await page.waitForSelector(`${SELECTORS.jsonData}, ${SELECTORS.unavailableMessage}`, {
                state: 'attached',
                timeout: 25000,
            });

            // Sprawdzamy, który z elementów się pojawił
            const isUnavailable = await page.locator(SELECTORS.unavailableMessage).count() > 0;
            if (isUnavailable) {
                log.warning(`Vehicle at ${request.url} is no longer available. Skipping.`);
                state.vehiclesFailed++; // Zliczamy jako błąd/pominięcie
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
            
            // DOBRA PRAKTYKA: Zapisz zrzut ekranu i HTML przy błędzie
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
// DOBRA PRAKTYKA: Inicjalizacja stanu przed uruchomieniem.
await crawler.useState({ vehiclesProcessed: 0, vehiclesFailed: 0 });

log.info('🏃‍♂️ Starting crawler...');
await crawler.run(startUrls);
log.info('✅ Crawler finished.');

const endTime = new Date();
const durationInSeconds = Math.round((endTime - startTime) / 1000);

// DOBRA PRAKTYKA: Odczytanie finalnego stanu i przygotowanie podsumowania.
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

// DOBRA PRAKTYKA: Zapisanie finalnych statystyk do Key-Value Store.
await Actor.setValue('OUTPUT', finalStats);

await Actor.exit();