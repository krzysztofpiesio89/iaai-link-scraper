# Użyj oficjalnego obrazu Apify dla Node.js 18 z Playwright
FROM apify/actor-node-playwright:18

# Skopiuj pliki package.json w celu instalacji zależności
COPY package.json ./

# Zainstaluj zależności zdefiniowane w package.json
# --omit=dev pomija zależności deweloperskie, aby obraz był mniejszy
RUN npm install --omit=dev

# Skopiuj resztę plików źródłowych (w tym Twój główny kod scrapera)
COPY . .

# Uruchom scrapera po starcie kontenera.
# Domyślnie Apify wywołuje polecenie "npm start"
CMD ["npm", "start"]