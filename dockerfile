# Użyj poprawnego obrazu bazowego Apify z Node.js i przeglądarką dla Playwright
FROM apify/actor-node-playwright-chrome:20

# Skopiuj wszystkie pliki (aby prisma schema był dostępny podczas npm install)
COPY . ./

# Zainstaluj zależności (postinstall script będzie mógł znaleźć prisma/schema.prisma)
RUN npm ci --only=production

# Uruchom scrapera
CMD npm start