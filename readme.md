# 🚀 IAAI Vehicle Detail Scraper

This Apify Actor scrapes detailed information for specific vehicles from `iaai.com` auction pages. Provide it with a list of vehicle URLs, and it will extract key details like VIN, mileage, damage reports, and auction information into a clean, structured format ready for database import.

## Key Features

-   **Detailed Extraction**: Gathers over 20 data points per vehicle.
-   **Data Cleaning**: Automatically parses and cleans data, converting values like mileage and prices into numbers and dates into a standard ISO format.
-   **Prisma-Ready Output**: The structured JSON output is designed to map directly to a database schema (e.g., Prisma), simplifying data storage.
-   **Robust & Resilient**: Finds data by semantic labels (like "VIN:") rather than brittle CSS selectors, making it more resistant to minor website layout changes.
-   **Proxy Support**: Integrates seamlessly with Apify Proxies to prevent blocking and ensure reliable scraping.

## How It Works

The Actor navigates to each provided vehicle URL, waits for the page content to load, and then systematically extracts information from the "Vehicle Details" section. It uses intelligent parsing functions to clean the raw text into usable data types before saving the final structured object.

## Input Configuration

The Actor requires the following input:

-   **Vehicle URLs (`startUrls`)**: A list of full URLs for the IAAI vehicle detail pages you want to scrape. You can paste one URL per line.
-   **Proxy Configuration (`proxyConfiguration`)**: It is **highly recommended** to use Apify Proxy to avoid being blocked by the website. The default settings are usually sufficient.

## Output Format

The Actor saves its results in the Apify Dataset. Each item is a JSON object containing the detailed specifications for a single vehicle.

**Example Output:**

```json
{
  "vehicleTitle": "2021 TESLA MODEL 3",
  "vin": "5YJ3E1EB4MFXXXXXX",
  "stockNumber": "39735871",
  "mileage": 24814,
  "primaryDamage": "FRONT END",
  "estimatedRetailValue": 35468,
  "hasKeys": true,
  "saleDate": "2025-09-25T15:30:00.000Z",
  "currentBid": 12500,
  "buyNowPrice": 15000,
  "sourceUrl": "[https://www.iaai.com/VehicleDetail/39735871~US](https://www.iaai.com/VehicleDetail/39735871~US)"
}
```

## How to Use

1.  Paste your list of IAAI vehicle URLs into the **Vehicle URLs** input field.
2.  Adjust proxy settings if needed (defaults are recommended).
3.  Click **Start**.
4.  Once the run is finished, you can preview and download your data from the **Storage** tab.