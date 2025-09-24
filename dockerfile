# Użyj poprawnego obrazu bazowego Apify z Node.js i przeglądarką dla Playwright
FROM apify/actor-node-playwright-chrome:20

# Skopiuj pliki package.json
COPY package*.json ./

# Zainstaluj zależności
RUN npm ci --only=production

# Skopiuj resztę kodu
COPY . ./

# Uruchom scrapera
CMD npm start