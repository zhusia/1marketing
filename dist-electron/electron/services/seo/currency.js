"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currencyForLocation = currencyForLocation;
/**
 * Maps a DataForSEO location name (a country, e.g. "United States", "Vietnam")
 * to the ISO currency its Google Ads bid values are reported in. DataForSEO
 * returns cpc / top-of-page bids in the location's local currency, so the UI
 * needs this to format them correctly (e.g. `$3.82` vs `₫22,727`).
 */
const CURRENCY_BY_COUNTRY = {
    'united states': 'USD',
    'united kingdom': 'GBP',
    canada: 'CAD',
    australia: 'AUD',
    'new zealand': 'NZD',
    india: 'INR',
    pakistan: 'PKR',
    bangladesh: 'BDT',
    'sri lanka': 'LKR',
    vietnam: 'VND',
    'viet nam': 'VND',
    thailand: 'THB',
    indonesia: 'IDR',
    malaysia: 'MYR',
    philippines: 'PHP',
    singapore: 'SGD',
    'hong kong': 'HKD',
    taiwan: 'TWD',
    japan: 'JPY',
    china: 'CNY',
    'south korea': 'KRW',
    germany: 'EUR',
    france: 'EUR',
    spain: 'EUR',
    italy: 'EUR',
    netherlands: 'EUR',
    belgium: 'EUR',
    austria: 'EUR',
    ireland: 'EUR',
    portugal: 'EUR',
    finland: 'EUR',
    greece: 'EUR',
    slovakia: 'EUR',
    slovenia: 'EUR',
    estonia: 'EUR',
    latvia: 'EUR',
    lithuania: 'EUR',
    luxembourg: 'EUR',
    croatia: 'EUR',
    cyprus: 'EUR',
    malta: 'EUR',
    switzerland: 'CHF',
    sweden: 'SEK',
    norway: 'NOK',
    denmark: 'DKK',
    poland: 'PLN',
    czechia: 'CZK',
    'czech republic': 'CZK',
    hungary: 'HUF',
    romania: 'RON',
    bulgaria: 'BGN',
    russia: 'RUB',
    ukraine: 'UAH',
    turkey: 'TRY',
    'türkiye': 'TRY',
    israel: 'ILS',
    'saudi arabia': 'SAR',
    'united arab emirates': 'AED',
    qatar: 'QAR',
    kuwait: 'KWD',
    egypt: 'EGP',
    morocco: 'MAD',
    'south africa': 'ZAR',
    nigeria: 'NGN',
    kenya: 'KES',
    brazil: 'BRL',
    mexico: 'MXN',
    argentina: 'ARS',
    chile: 'CLP',
    colombia: 'COP',
    peru: 'PEN',
};
const DEFAULT_CURRENCY = 'USD';
function currencyForLocation(location) {
    if (!location)
        return DEFAULT_CURRENCY;
    return CURRENCY_BY_COUNTRY[location.trim().toLowerCase()] ?? DEFAULT_CURRENCY;
}
//# sourceMappingURL=currency.js.map