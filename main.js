import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

const SELECTORS = {
    vehicleLink: 'a[href^="/VehicleDetail/"]',
    cookieConsentButtons: '#truste-consent-button, button[class*="cookie"], button[class*="consent"]',
    jsonData: 'script#ProductDetailsVM',
    unavailableMessage: '.message-panel__title:has-text("Vehicle Details Are Not Available")',
    captcha: 'iframe[src*="recaptcha"], .g-recaptcha, .h-captcha, #challenge-form, text=/verify you are human/i',
};

await Actor.init();

console.log('🚀 IAAI All-In-One Scraper (Stealth Enhanced) - Starting...');

const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType', userData: { label: 'LIST' } }],
    maxPages = 5,
    proxyConfiguration,
} = await Actor.getInput() ?? {};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: await Actor.createProxyConfiguration(proxyConfiguration),
    maxConcurrency: 10,
    navigationTimeoutSecs: 120, // DOBRA PRAKTYKA: Zwiększony timeout nawigacji

    // DOBRA PRAKTYKA: Użycie hooków do przygotowania przeglądarki PRZED nawigacją
    preNavigationHooks: [
        async ({ page, request }, hook) => {
            await page.setExtraHTTPHeaders({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            });
            await page.setViewportSize({ width: 1920, height: 1080 });
        },
    ],
    
    async requestHandler({ page, request, log, crawler }) {
        const { label, ...userData } = request.userData;

        // Sprawdzenie CAPTCHA po załadowaniu strony
        if (await page.locator(SELECTORS.captcha).count() > 0) {
            throw new Error(`CAPTCHA detected on ${request.url}. Ensure RESIDENTIAL proxies are used.`);
        }
        
        // Obsługa cookies po załadowaniu
        const cookieButton = page.locator(SELECTORS.cookieConsentButtons).first();
        if (await cookieButton.isVisible({ timeout: 5000 })) {
            log.info('🍪 Accepting cookie consent...');
            await cookieButton.click();
        }

        if (label === 'LIST') {
            log.info(`📄 Processing LIST page: ${request.url}`);
            await page.waitForSelector(SELECTORS.vehicleLink, { timeout: 30000 });

            const vehicleEntries = await page.evaluate((selector) => {
                const results = [];
                document.querySelectorAll(selector).forEach(el => {
                    const url = new URL(el.getAttribute('href'), location.origin).href;
                    const title = el.textContent.trim();
                    const yearMatch = title.match(/^\d{4}/);
                    const make = yearMatch ? title.substring(5).split(' ')[0] : null;

                    results.push({
                        url,
                        userData: { label: 'DETAIL', make, year: yearMatch ? yearMatch[0] : null },
                    });
                });
                return results;
            }, SELECTORS.vehicleLink);

            log.info(`Found ${vehicleEntries.length} vehicle links. Enqueuing detail pages...`);
            await crawler.addRequests(vehicleEntries);

            // Tutaj można w przyszłości dodać logikę paginacji, jeśli będzie potrzebna

        } else if (label === 'DETAIL') {
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
            const saleInfoValues = jsonData.inventoryView?.saleInformation?.$values || [];
            const findSaleInfo = (key) => saleInfoValues.find(item => item.key === key)?.value || null;

            const vehicleInfo = { /* ... Twoja logika mapowania ... */ };
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
        // Można tu dodać logikę zapisu zrzutu ekranu, jeśli jest potrzebna
    },
});

console.log('🏃‍♂️ Starting all-in-one scraper...');
await crawler.run(startUrls);
console.log('✅ Scraper finished.');

await Actor.exit();