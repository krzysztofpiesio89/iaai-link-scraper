import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

// DOBRA PRAKTYKA: Centralizacja selektorów
const SELECTORS = {
    // Selektory dla strony listy
    vehicleLink: 'a[href^="/VehicleDetail/"]',
    nextTenButton: 'button.btn-next-10',
    getPageButton: (pageNumber) => `button#PageNumber${pageNumber}`,
    
    // Selektory dla strony szczegółów
    jsonData: 'script#ProductDetailsVM',
    unavailableMessage: '.message-panel__title:has-text("Vehicle Details Are Not Available")',
    captcha: 'iframe[src*="recaptcha"], .g-recaptcha, .h-captcha, #challenge-form, text=/verify you are human/i',
};

await Actor.init();

console.log('🚀 IAAI All-In-One Scraper - Starting...');

const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType', userData: { label: 'LIST' } }],
    maxPages = 5, // Ustaw niższy domyślny limit dla tego typu scrapera
    proxyConfiguration,
} = await Actor.getInput() ?? {};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: await Actor.createProxyConfiguration(proxyConfiguration),
    maxConcurrency: 10, // Możemy zwiększyć, bo zadania szczegółów są niezależne

    async requestHandler({ page, request, log, crawler }) {
        const { label, ...userData } = request.userData;

        if (label === 'LIST') {
            // --- LOGIKA DLA STRONY Z LISTĄ WYNIKÓW ---
            log.info(`📄 Processing LIST page: ${request.url}`);

            await page.waitForSelector(SELECTORS.vehicleLink, { timeout: 25000 }).catch(() => {
                log.warning('No vehicle links found on the page, might be the end.');
            });

            // Wyodrębnij linki i dane (w tym markę)
            const vehicleEntries = await page.evaluate((selector) => {
                const results = [];
                document.querySelectorAll(selector).forEach(el => {
                    const url = new URL(el.getAttribute('href'), location.origin).href;
                    const title = el.textContent.trim(); // np. "2003 DODGE RAM 1500"
                    const yearMatch = title.match(/^\d{4}/);
                    const make = yearMatch ? title.substring(5).split(' ')[0] : null;

                    results.push({
                        url,
                        userData: {
                            label: 'DETAIL',
                            make,
                            year: yearMatch ? yearMatch[0] : null,
                        },
                    });
                });
                return results;
            }, SELECTORS.vehicleLink);

            log.info(`Found ${vehicleEntries.length} vehicle links on this page.`);
            await crawler.addRequests(vehicleEntries);

            // Paginacja
            const currentPage = userData.pageNumber || 1;
            if (currentPage < maxPages) {
                // Logika paginacji (przejście na następną stronę listy)
                // ... (można dodać logikę paginacji z poprzedniego scrapera, jeśli potrzebne)
            }

        } else if (label === 'DETAIL') {
            // --- LOGIKA DLA STRONY ZE SZCZEGÓŁAMI POJAZDU ---
            log.info(`🚗 Processing DETAIL page: ${request.url}`);

            await page.waitForSelector(`${SELECTORS.jsonData}, ${SELECTORS.unavailableMessage}`, { state: 'attached', timeout: 25000 });
            
            if (await page.locator(SELECTORS.unavailableMessage).count() > 0) {
                log.warning(`Vehicle at ${request.url} is unavailable. Skipping.`);
                return;
            }

            const jsonData = await page.evaluate((selector) => {
                const scriptTag = document.querySelector(selector);
                return scriptTag ? JSON.parse(scriptTag.textContent) : null;
            }, SELECTORS.jsonData);

            if (!jsonData) throw new Error('Could not find ProductDetailsVM JSON data.');

            const attributes = jsonData.inventoryView?.attributes || {};
            const saleInfo = jsonData.inventoryView?.saleInformation?.$values || [];
            
            const findSaleInfo = (key) => saleInfo.find(item => item.key === key)?.value || null;

            const vehicleInfo = {
                "Make": userData.make || attributes.Make,
                "Model": attributes.Model,
                "Year": userData.year || attributes.Year,
                "Stock #": attributes.StockNumber,
                "VIN (Status)": attributes.VINMask,
                "Odometer": attributes.ODOValue ? `${attributes.ODOValue} ${attributes.ODOUoM} (${attributes.ODOBrand})` : null,
                "Start Code": attributes.StartsDesc,
                "Key": attributes.Keys === 'True' ? 'Present' : 'Not Present',
                "Primary Damage": attributes.PrimaryDamageDesc,
                "Secondary Damage": attributes.SecondaryDamageDesc,
                "Body Style": attributes.BodyStyleName,
                "Engine": attributes.EngineSize || attributes.EngineInformation,
                "Transmission": attributes.Transmission,
                "Drive Line Type": attributes.DriveLineTypeDesc,
                "Fuel Type": attributes.FuelTypeDesc,
                "Cylinders": attributes.CylindersDesc,
                "Restraint System": attributes.RestraintType,
                "Exterior/Interior": `${attributes.ExteriorColor} / ${attributes.InteriorColor}`,
                "Manufactured In": attributes.CountryOfOrigin,
                "Title/Sale Doc": findSaleInfo("TitleSaleDoc"),
                "Actual Cash Value": findSaleInfo("ActualCashValue"),
                "Selling Branch": attributes.BranchName,
                "Auction Date and Time": findSaleInfo("AuctionDateTime"),
                "Lane/Run #": findSaleInfo("Lane"),
            };

            const images = (jsonData.inventoryView?.imageDimensions?.keys || []).map(img => ({
                hdUrl: `https://vis.iaai.com/resizer?imageKeys=${img.k}`,
                thumbUrl: `https://vis.iaai.com/resizer?imageKeys=${img.k}&width=161&height=120`,
            }));

            await Dataset.pushData({ vehicleInfo, images });
            log.info(`✅ Successfully scraped details for Stock #: ${vehicleInfo["Stock #"]}`);
        }
    },

    async failedRequestHandler({ request, log }) {
        log.error(`💀 Request failed: ${request.url}`);
    },
});

console.log('🏃‍♂️ Starting all-in-one scraper...');
await crawler.run(startUrls);
console.log('✅ Scraper finished.');

await Actor.exit();