// Test funkcji tłumaczenia kodów uszkodzeń
const damageMapping = {
    // Kody uszkodzeń (Primary Damage)
    'All Over': 'Całość',
    'Electrical': 'Elektryka',
    'Engine Burn': 'Spalony Silnik',
    'Engine Damage': 'Uszkodzenie Silnika',
    'Exterior Burn': 'Spalony Zewnętrznie',
    'Flood': 'Powódź',
    'Front': 'Przód',
    'Front & Rear': 'Przód i Tył',
    'Front End': 'Przednia Część',
    'Hail': 'Grad',
    'Interior Burn': 'Spalony Wewnętrznie',
    'Left Front': 'Lewy Przód',
    'Left Rear': 'Lewy Tył',
    'Left Side': 'Lewy Bok',
    'Mechanical': 'Mechaniczne',
    'Rear': 'Tył',
    'Right Front': 'Prawy Przód',
    'Right Rear': 'Prawy Tył',
    'Right Side': 'Prawy Bok',
    'Roll Over': 'Dachowanie',
    'Rollover': 'Dachowanie',
    'Suspension': 'Zawieszenie',
    'Theft': 'Kradzież',
    'Total Burn': 'Całkowicie Spalony',
    'Vandalized': 'Wandalizm',
    'Undercarriage': 'Podwozie',
    'Unknown': 'Nieznane',
    'Strip': 'Ogołocony',
    'None': 'Brak',
    
    // Kody typu straty (Loss Type)
    'Collision': 'Kolizja',
    'Wreck': 'Wrak / Zniszczenie',
    'Water': 'Wodne',
    'Fire': 'Pożar',
    'Salvage': 'Wrak / Do kasacja', // często używane dla typu straty
    'Biohazard': 'Zagrożenie Biologiczne', 
};

// Funkcja tłumaczenia (identyczna z tej w main.js)
function translateDamageType(damageType) {
    let translatedDamage = '';
    if (damageType) {
        // Rozdzielamy ciąg znaków separatorem " / "
        const damageParts = damageType.split(' / ');
        // Tłumaczymy każdą część i łączymy z powrotem
        const translatedParts = damageParts.map(part => {
            const trimmedPart = part.trim();
            return damageMapping[trimmedPart] || trimmedPart; // Używamy oryginalnej wartości jeśli nie ma tłumaczenia
        });
        translatedDamage = translatedParts.join(' / ');
    }
    return translatedDamage;
}

// Test cases
const testCases = [
    "All Over / Collision",
    "Left Front / Collision", 
    "Right Rear / Water",
    "Front End / Fire",
    "Rear / Wreck",
    "Unknown",
    "Front & Rear",
    "Mechanical",
    "Total Burn / Fire",
    "Hail"
];

console.log("🧪 Test funkcji tłumaczenia kodów uszkodzeń:");
console.log("=".repeat(50));

testCases.forEach((testCase, index) => {
    const result = translateDamageType(testCase);
    console.log(`${index + 1}. "${testCase}" → "${result}"`);
});

console.log("\n✅ Test zakończony pomyślnie!");