import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

// DOBRA PRAKTYKA: Centralizacja selektorów
const SELECTORS = {
    vehicleRow: 'div.table-row.table-row-border', // Kontener dla każdego pojazdu
    vehicleLink: 'a[href^="/VehicleDetail/"]',
    title: 'h4.heading-7 a',
    thumbnail: 'img.lazyload',
    cookieConsentButtons: '#truste-consent-button, button[class*="cookie"]',
    nextTenButton: 'button.btn-next-10',
    getPageButton: (pageNumber) => `button#PageNumber${pageNumber}`,
};

await Actor.init();

console.log('🚀 IAAI List & Basic Data Scraper - Starting...');

const {
    startUrls = [{ url: 'https://www.iaai.com/Search?queryFilterValue=Buy%20Now&queryFilterGroup=AuctionType' }],
    maxPages = 5,
    proxyConfiguration,
} = await Actor.getInput() ?? {};

// --- NOWA FUNKCJA DO EKSTRAKCJI BOGATSZYCH DANYCH ---
const extractVehicleDataFromList = (page) => {
    return page.evaluate((selectors) => {
        const results = [];
        // Iterujemy po każdym wierszu z pojazdem
        document.querySelectorAll(selectors.vehicleRow).forEach(row => {
            const linkElement = row.querySelector(selectors.vehicleLink);
            const titleElement = row.querySelector(selectors.title);
            const imageElement = row.querySelector(selectors.thumbnail);

            if (!linkElement || !titleElement || !imageElement) {
                return; // Pomiń, jeśli brakuje kluczowych elementów
            }

            const detailUrl = new URL(linkElement.getAttribute('href'), location.origin).href;
            const imageUrl = imageElement.getAttribute('data-src') || imageElement.getAttribute('src');
            const title = titleElement.textContent.trim();
            
            const yearMatch = title.match(/^\d{4}/);
            const year = yearMatch ? yearMatch[0] : null;
            const make = year ? title.substring(5).split(' ')[0] : null;
            const model = make ? title.substring(5 + make.length).trim() : title;

            results.push({
                detailUrl,
                year,
                make,
                model,
                imageUrl,
            });
        });
        return results;
    }, SELECTORS);
};

// ... (reszta funkcji pomocniczych i crawlera jak w poprzedniej wersji z dobrymi praktykami)

const crawler = new PlaywrightCrawler({
    proxyConfiguration: await Actor.createProxyConfiguration(proxyConfiguration),
    maxConcurrency: 1,
    navigationTimeoutSecs: 120,

    async requestHandler({ page, request, log }) {
        const state = await crawler.useState();
        log.info(`📖 Processing list page: ${request.url}`);
        
        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

        // Obsługa cookies
        const cookieButton = page.locator(SELECTORS.cookieConsentButtons).first();
        if (await cookieButton.isVisible({ timeout: 5000 })) {
            log.info('🍪 Accepting cookie consent...');
            await cookieButton.click();
        }
        
        await page.waitForSelector(SELECTORS.vehicleRow, { timeout: 25000 });

        let currentPage = 1;
        while (currentPage <= maxPages) {
            log.info(`\n📄 === Scraping page ${currentPage} ===`);
            
            const vehiclesOnPage = await extractVehicleDataFromList(page);
            log.info(`✅ Found ${vehiclesOnPage.length} vehicles on page ${currentPage}.`);

            if (vehiclesOnPage.length === 0) {
                log.warning('No vehicles found, stopping pagination.');
                break;
            }

            await Dataset.pushData(vehiclesOnPage);
            state.vehiclesFound += vehiclesOnPage.length;
            state.pagesProcessed = currentPage;

            if (currentPage >= maxPages) {
                log.info(`🏁 Reached maxPages limit of ${maxPages}. Stopping.`);
                break;
            }

            // ... Logika paginacji (bez zmian)
            // ... (tutaj powinna być funkcja navigateToNextPage)
            
            currentPage++; // uproszczenie, w pełnej wersji powinna być tu logika nawigacji
        }
    },

    async failedRequestHandler({ request, log }) {
        // ... (obsługa błędów, bez zmian)
    },
});

await crawler.useState({ pagesProcessed: 0, vehiclesFound: 0, errors: 0 });

console.log('🏃‍♂️ Starting scraper for basic data...');
await crawler.run(startUrls);
console.log('✅ Scraper finished.');

const finalState = await crawler.useState();
await Actor.setValue('OUTPUT', finalState);

await Actor.exit();