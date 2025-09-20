import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

console.log('🚀 IAAI Vehicle Detail Scraper - Starting...');

const input = await Actor.getInput() ?? {};
const {
    startUrls = [], // Oczekuje tablicy obiektów, np. [{ "url": "https://..." }]
    proxyConfiguration,
} = input;

// Funkcje pomocnicze do czyszczenia danych
const parseNumber = (str) => {
    if (!str) return null;
    // Usuwa symbole walut, przecinki, "mi" i inne znaki, pozostawiając tylko cyfry i kropkę
    const cleaned = str.replace(/[$,\smiUSD]/g, '');
    const number = parseFloat(cleaned);
    return isNaN(number) ? null : number;
};

const parseDate = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    try {
        // Łączy datę i czas, np. "09/25/2025" i "10:30 AM (CDT)"
        // Usuwa informację o strefie czasowej z nawiasów dla lepszej kompatybilności
        const cleanedTime = timeStr.replace(/\s\(.*\)/, '');
        const dateTimeString = `${dateStr} ${cleanedTime}`;
        return new Date(dateTimeString).toISOString(); // Zwraca datę w formacie ISO 8601
    } catch (e) {
        console.log(`Could not parse date: ${dateStr} ${timeStr}`);
        return null;
    }
};

const crawler = new PlaywrightCrawler({
    proxyConfiguration: await Actor.createProxyConfiguration(proxyConfiguration),
    maxConcurrency: 10, // Można zwiększyć, bo każde zadanie jest niezależne

    async requestHandler({ page, request }) {
        console.log(`🛠️ Processing: ${request.url}`);

        try {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Czekamy na załadowanie kluczowych informacji
            await page.waitForSelector('dl.data-list--details', { timeout: 15000 });

            // Główna logika ekstrakcji danych w kontekście strony
            const vehicleData = await page.evaluate((helpers) => {
                // Konwertujemy funkcje pomocnicze na string, aby przekazać je do przeglądarki
                const parseNum = new Function(`return ${helpers.parseNumber}`)();
                const parseDt = new Function(`return ${helpers.parseDate}`)();

                // Funkcja do pobierania tekstu z elementu <dd> na podstawie etykiety <dt>
                const getElementTextByLabel = (label) => {
                    const allTerms = document.querySelectorAll('dt');
                    const foundTerm = Array.from(allTerms).find(el => el.textContent?.trim() === label);
                    return foundTerm?.nextElementSibling?.textContent?.trim() || null;
                };
                
                // --- Ekstrakcja Danych ---
                const titleElement = document.querySelector('h1.heading-alpha');
                const vehicleTitle = titleElement ? titleElement.textContent.trim() : null;

                const saleDateRaw = getElementTextByLabel('Sale Date:');
                const saleTimeRaw = getElementTextByLabel('Time:');

                const data = {
                    vehicleTitle,
                    vin: getElementTextByLabel('VIN:'),
                    stockNumber: getElementTextByLabel('Stock #:'),
                    mileage: parseNum(getElementTextByLabel('Odometer:')),
                    primaryDamage: getElementTextByLabel('Primary Damage:'),
                    secondaryDamage: getElementTextByLabel('Secondary Damage:'),
                    estimatedRetailValue: parseNum(getElementTextByLabel('Est. Retail Value:')),
                    bodyStyle: getElementTextByLabel('Body Style:'),
                    engine: getElementTextByLabel('Engine:'),
                    transmission: getElementTextByLabel('Transmission:'),
                    fuelType: getElementTextByLabel('Fuel Type:'),
                    cylinders: getElementTextByLabel('Cylinders:'),
                    hasKeys: getElementTextByLabel('Keys:')?.toLowerCase() === 'yes', // Konwersja na boolean
                    driveLineType: getElementTextByLabel('Driveline:'),
                    saleDocument: getElementTextByLabel('Sale Document:'),

                    // Informacje o aukcji
                    auctionLocation: getElementTextByLabel('Auction Center:'),
                    saleDate: parseDt(saleDateRaw, saleTimeRaw),
                    auctionItemNumber: getElementTextByLabel('Item #:'),
                    
                    // Informacje o licytacji
                    currentBid: parseNum(document.querySelector('[data-bind="text: currentBid"]')?.textContent?.trim()),
                    buyNowPrice: parseNum(document.querySelector('.buy-now-price')?.textContent?.trim())
                };

                return data;
            }, { // Przekazanie funkcji pomocniczych jako stringi
                parseNumber: parseNumber.toString(),
                parseDate: parseDate.toString(),
            });

            // Dodajemy URL do finalnego obiektu
            vehicleData.sourceUrl = request.url;

            await Dataset.pushData(vehicleData);
            console.log(`✅ Successfully extracted data for: ${vehicleData.vin}`);

        } catch (error) {
            console.error(`❌ Failed to process ${request.url}: ${error.message}`);
            await Actor.fail();
        }
    },
});

await crawler.run(startUrls);

await Actor.exit();