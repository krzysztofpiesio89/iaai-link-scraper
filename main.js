import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

console.log('🚀 IAAI Vehicle Detail Scraper (Optimized with JSON Extraction) - Starting...');

const input = await Actor.getInput() ?? {};
const {
    startUrls = [],
    proxyConfiguration,
} = input;

// Funkcje pomocnicze do czyszczenia danych
const parseNumber = (str) => {
    if (!str || typeof str !== 'string') return null;
    const cleaned = str.replace(/[$,\smiUSD]/g, '');
    const number = parseFloat(cleaned);
    return isNaN(number) ? null : number;
};

// Uproszczona funkcja - teraz przyjmuje jeden pełny string daty
const parseDate = (dateStr) => {
    if (!dateStr) return null;
    try {
        return new Date(dateStr).toISOString();
    } catch (e) {
        console.log(`Could not parse date: ${dateStr}`);
        return null;
    }
};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: await Actor.createProxyConfiguration(proxyConfiguration),
    maxConcurrency: 10,

    async requestHandler({ page, request }) {
        console.log(`🛠️ Processing: ${request.url}`);

        try {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            const unavailableMessage = page.locator('h2:has-text("Vehicle Details Are Not Available")');
            if (await unavailableMessage.isVisible({ timeout: 5000 })) {
                console.log(`🟡 Vehicle at ${request.url} is no longer available. Skipping.`);
                return;
            }

            // --- POPRAWKA TUTAJ ---
            // Czekamy na tag <script> aż będzie DOŁĄCZONY do DOM, a nie widoczny.
            await page.waitForSelector('script#ProductDetailsVM', { state: 'attached', timeout: 15000 });

            const jsonData = await page.evaluate(() => {
                const scriptTag = document.getElementById('ProductDetailsVM');
                return scriptTag ? JSON.parse(scriptTag.textContent) : null;
            });

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
            console.log(`✅ Successfully extracted data for VIN: ${vehicleData.vin}`);

        } catch (error) {
            console.error(`❌ Failed to process ${request.url}: ${error.message}`);
        }
    },
});

await crawler.run(startUrls);

await Actor.exit();