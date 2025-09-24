import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

// Initialize the Actor
await Actor.init();
console.log('🚀 IAAI Basic Data Scraper - Starting...');

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

const stats = { pagesProcessed: 0, vehiclesFound: 0, errors: 0, startTime: new Date() };

// --- NOWA FUNKCJA DO WYODRĘBNIANIA PEŁNYCH DANYCH Z LISTY ---
const extractVehicleDataFromList = async (page) => {
    // Ta funkcja jest wykonywana w przeglądarce. Musi być samowystarczalna.
    return page.evaluate(() => {
        const results = [];
        // Każdy pojazd na liście znajduje się w kontenerze z tymi klasami
        const vehicleRows = document.querySelectorAll('div.table-row.table-row-border');

        vehicleRows.forEach(row => {
            try {
                const linkElement = row.querySelector('h4.heading-7 a');
                const imageElement = row.querySelector('.table-cell--image img');
                
                if (!linkElement || !imageElement) {
                    return; // Pomiń ten wiersz, jeśli nie ma linku lub obrazka
                }

                // 1. Link do szczegółów
                const detailUrl = new URL(linkElement.getAttribute('href'), location.origin).href;

                // 2. Rok, Marka, Model
                const title = linkElement.textContent.trim(); // np. "2014 FORD F-150 XL"
                const yearMatch = title.match(/^\d{4}/);
                const year = yearMatch ? yearMatch[0] : null;
                const make = year ? title.substring(5).split(' ')[0] : null;
                const model = make ? title.substring(5 + make.length).trim() : title;

                // 3. Link do zdjęcia
                const imageUrl = imageElement.getAttribute('data-src') || imageElement.getAttribute('src');

                results.push({
                    detailUrl,
                    year,
                    make,
                    model,
                    imageUrl,
                });
            } catch (e) {
                // Ignoruj błędy dla pojedynczych wierszy, aby nie zatrzymać całego scrapingu
                console.warn('Could not process a vehicle row:', e.message);
            }
        });
        return results;
    });
};


// ## ORYGINALNE FUNKCJE POMOCNICZE (BEZ ZMIAN) ##

const checkForCaptcha = async (page) => {
    // ... bez zmian
};
const handleCookieConsent = async (page) => {
    // ... bez zmian
};
const waitForResults = async (page, timeout = 15000) => {
    // ... bez zmian
};
const navigateToPageNumber = async (page, pageNumber) => {
    // ... bez zmian
};
const navigateToNextTenPages = async (page) => {
    // ... bez zmian
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
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage'
            ]
        },
        useChrome: true,
    },
    async requestHandler({ page, request }) {
        const url = request.url;
        console.log(`📖 Processing: ${url}`);

        try {
            await page.setViewportSize({ width: 1920, height: 1080 });
            await page.setExtraHTTPHeaders({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            console.log('🌐 Navigating to the page...');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            if (await checkForCaptcha(page)) {
                console.log('🤖 CAPTCHA detected - aborting run.');
                stats.errors++;
                throw new Error('CAPTCHA detected, cannot proceed.');
            }

            await handleCookieConsent(page);
            await waitForResults(page);

            let currentPage = 1;
            while (currentPage <= maxPages) {
                console.log(`\n📄 === Scraping page ${currentPage} ===`);

                // --- ZASTOSOWANIE NOWEJ FUNKCJI ---
                const vehiclesData = await extractVehicleDataFromList(page);
                console.log(`✅ Found ${vehiclesData.length} vehicles on page ${currentPage}`);

                if (vehiclesData.length > 0) {
                    stats.vehiclesFound += vehiclesData.length;
                    
                    // Zapisujemy nowe, bogatsze dane
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
            console.log(`❌ Main error processing ${url}:`, error.message);
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
stats.duration = (stats.endTime - stats.startTime);
console.log('\n' + '='.repeat(50));
console.log('🎉 Crawling completed!');
// Zaktualizowane statystyki
console.log('📊 Final Statistics:', {
    pagesProcessed: stats.pagesProcessed,
    vehiclesFound: stats.vehiclesFound,
    errors: stats.errors,
    duration: `${Math.round(stats.duration / 1000)}s`,
});
console.log('='.repeat(50));

await Actor.exit();