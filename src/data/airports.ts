// Real airports (IATA codes). `pop` is the catchment population in millions,
// `wealth` a relative income index (1 ≈ high-income country), `tourism` a
// destination-appeal index, and `size` a 1–5 traffic tier used for fees.

export type Region = 'NA' | 'SA' | 'EU' | 'ME' | 'AF' | 'AS' | 'OC';

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
  pop: number;
  wealth: number;
  tourism: number;
  size: 1 | 2 | 3 | 4 | 5;
  region: Region;
}

type Row = [string, string, string, string, number, number, number, number, number, 1 | 2 | 3 | 4 | 5, Region];

const rows: Row[] = [
  // North America
  ['ATL', 'Hartsfield–Jackson', 'Atlanta', 'US', 33.64, -84.43, 6.3, 1.15, 0.6, 5, 'NA'],
  ['LAX', 'Los Angeles Intl', 'Los Angeles', 'US', 33.94, -118.41, 13.2, 1.2, 1.2, 5, 'NA'],
  ['ORD', "O'Hare", 'Chicago', 'US', 41.98, -87.9, 9.5, 1.15, 0.7, 5, 'NA'],
  ['DFW', 'Dallas/Fort Worth', 'Dallas', 'US', 32.9, -97.04, 7.9, 1.15, 0.5, 5, 'NA'],
  ['DEN', 'Denver Intl', 'Denver', 'US', 39.86, -104.67, 3.0, 1.15, 0.8, 4, 'NA'],
  ['JFK', 'John F. Kennedy', 'New York', 'US', 40.64, -73.78, 11.0, 1.3, 1.4, 5, 'NA'],
  ['EWR', 'Newark Liberty', 'New York', 'US', 40.69, -74.17, 8.0, 1.25, 0.8, 4, 'NA'],
  ['SFO', 'San Francisco Intl', 'San Francisco', 'US', 37.62, -122.38, 7.7, 1.4, 1.0, 5, 'NA'],
  ['SEA', 'Seattle–Tacoma', 'Seattle', 'US', 47.45, -122.31, 4.1, 1.3, 0.7, 4, 'NA'],
  ['LAS', 'Harry Reid', 'Las Vegas', 'US', 36.08, -115.15, 2.3, 1.0, 1.6, 4, 'NA'],
  ['MCO', 'Orlando Intl', 'Orlando', 'US', 28.43, -81.31, 2.7, 1.0, 1.6, 4, 'NA'],
  ['MIA', 'Miami Intl', 'Miami', 'US', 25.79, -80.29, 6.2, 1.05, 1.3, 5, 'NA'],
  ['BOS', 'Logan', 'Boston', 'US', 42.36, -71.01, 4.9, 1.35, 0.9, 4, 'NA'],
  ['IAD', 'Dulles', 'Washington', 'US', 38.95, -77.46, 6.3, 1.35, 0.9, 4, 'NA'],
  ['PHX', 'Sky Harbor', 'Phoenix', 'US', 33.43, -112.01, 5.0, 1.05, 0.7, 4, 'NA'],
  ['IAH', 'George Bush', 'Houston', 'US', 29.98, -95.34, 7.3, 1.1, 0.5, 5, 'NA'],
  ['MSP', 'Minneapolis–St Paul', 'Minneapolis', 'US', 44.88, -93.22, 3.7, 1.15, 0.5, 4, 'NA'],
  ['DTW', 'Detroit Metro', 'Detroit', 'US', 42.21, -83.35, 4.3, 1.0, 0.4, 4, 'NA'],
  ['CLT', 'Charlotte Douglas', 'Charlotte', 'US', 35.21, -80.94, 2.8, 1.1, 0.4, 4, 'NA'],
  ['PHL', 'Philadelphia Intl', 'Philadelphia', 'US', 39.87, -75.24, 6.2, 1.15, 0.7, 4, 'NA'],
  ['HNL', 'Daniel K. Inouye', 'Honolulu', 'US', 21.32, -157.92, 1.0, 1.05, 1.8, 3, 'OC'],
  ['YYZ', 'Toronto Pearson', 'Toronto', 'CA', 43.68, -79.63, 6.7, 1.0, 0.8, 5, 'NA'],
  ['YVR', 'Vancouver Intl', 'Vancouver', 'CA', 49.19, -123.18, 2.7, 1.0, 1.0, 4, 'NA'],
  ['YUL', 'Montréal–Trudeau', 'Montréal', 'CA', 45.47, -73.74, 4.3, 0.95, 0.9, 4, 'NA'],
  ['YYC', 'Calgary Intl', 'Calgary', 'CA', 51.13, -114.01, 1.6, 1.05, 0.6, 3, 'NA'],
  ['MEX', 'Benito Juárez', 'Mexico City', 'MX', 19.44, -99.07, 21.8, 0.35, 0.9, 5, 'NA'],
  ['CUN', 'Cancún Intl', 'Cancún', 'MX', 21.04, -86.87, 0.9, 0.4, 1.9, 4, 'NA'],
  ['PTY', 'Tocumen', 'Panama City', 'PA', 9.07, -79.38, 1.9, 0.55, 0.7, 4, 'NA'],
  ['SJU', 'Luis Muñoz Marín', 'San Juan', 'PR', 18.44, -66.0, 2.3, 0.7, 1.3, 3, 'NA'],
  // South America
  ['BOG', 'El Dorado', 'Bogotá', 'CO', 4.7, -74.15, 11.0, 0.3, 0.7, 4, 'SA'],
  ['LIM', 'Jorge Chávez', 'Lima', 'PE', -12.02, -77.11, 11.0, 0.3, 0.9, 4, 'SA'],
  ['GRU', 'Guarulhos', 'São Paulo', 'BR', -23.43, -46.47, 22.0, 0.35, 0.6, 5, 'SA'],
  ['GIG', 'Galeão', 'Rio de Janeiro', 'BR', -22.81, -43.25, 13.0, 0.33, 1.3, 4, 'SA'],
  ['EZE', 'Ezeiza', 'Buenos Aires', 'AR', -34.82, -58.54, 15.0, 0.4, 0.9, 4, 'SA'],
  ['SCL', 'Arturo Merino Benítez', 'Santiago', 'CL', -33.39, -70.79, 7.0, 0.5, 0.8, 4, 'SA'],
  // Europe
  ['LHR', 'Heathrow', 'London', 'GB', 51.47, -0.45, 9.5, 1.15, 1.4, 5, 'EU'],
  ['LGW', 'Gatwick', 'London', 'GB', 51.15, -0.19, 4.5, 1.1, 1.2, 4, 'EU'],
  ['STN', 'Stansted', 'London', 'GB', 51.89, 0.24, 2.5, 1.0, 1.0, 3, 'EU'],
  ['MAN', 'Manchester', 'Manchester', 'GB', 53.36, -2.27, 2.8, 0.95, 0.7, 4, 'EU'],
  ['EDI', 'Edinburgh', 'Edinburgh', 'GB', 55.95, -3.37, 1.4, 1.0, 1.1, 3, 'EU'],
  ['DUB', 'Dublin', 'Dublin', 'IE', 53.42, -6.27, 2.0, 1.4, 1.0, 4, 'EU'],
  ['CDG', 'Charles de Gaulle', 'Paris', 'FR', 49.01, 2.55, 8.5, 1.1, 1.6, 5, 'EU'],
  ['ORY', 'Orly', 'Paris', 'FR', 48.72, 2.38, 4.5, 1.05, 1.2, 4, 'EU'],
  ['NCE', "Côte d'Azur", 'Nice', 'FR', 43.66, 7.22, 1.0, 1.0, 1.5, 3, 'EU'],
  ['AMS', 'Schiphol', 'Amsterdam', 'NL', 52.31, 4.76, 4.0, 1.25, 1.3, 5, 'EU'],
  ['BRU', 'Brussels', 'Brussels', 'BE', 50.9, 4.48, 2.6, 1.15, 0.9, 4, 'EU'],
  ['FRA', 'Frankfurt', 'Frankfurt', 'DE', 50.03, 8.56, 5.8, 1.2, 0.8, 5, 'EU'],
  ['MUC', 'Munich', 'Munich', 'DE', 48.35, 11.79, 6.0, 1.25, 1.0, 5, 'EU'],
  ['BER', 'Berlin Brandenburg', 'Berlin', 'DE', 52.37, 13.5, 4.6, 1.05, 1.2, 4, 'EU'],
  ['DUS', 'Düsseldorf', 'Düsseldorf', 'DE', 51.29, 6.77, 5.0, 1.1, 0.6, 4, 'EU'],
  ['HAM', 'Hamburg', 'Hamburg', 'DE', 53.63, 9.99, 3.2, 1.15, 0.8, 3, 'EU'],
  ['ZRH', 'Zürich', 'Zürich', 'CH', 47.46, 8.55, 2.0, 1.6, 1.0, 4, 'EU'],
  ['GVA', 'Geneva', 'Geneva', 'CH', 46.24, 6.11, 1.0, 1.6, 1.1, 3, 'EU'],
  ['VIE', 'Vienna', 'Vienna', 'AT', 48.11, 16.57, 2.9, 1.2, 1.1, 4, 'EU'],
  ['CPH', 'Kastrup', 'Copenhagen', 'DK', 55.62, 12.66, 2.5, 1.3, 1.0, 4, 'EU'],
  ['ARN', 'Arlanda', 'Stockholm', 'SE', 59.65, 17.92, 2.4, 1.25, 0.9, 4, 'EU'],
  ['OSL', 'Gardermoen', 'Oslo', 'NO', 60.19, 11.1, 1.6, 1.5, 0.9, 4, 'EU'],
  ['HEL', 'Helsinki-Vantaa', 'Helsinki', 'FI', 60.32, 24.95, 1.5, 1.15, 0.8, 4, 'EU'],
  ['KEF', 'Keflavík', 'Reykjavík', 'IS', 63.99, -22.62, 0.25, 1.3, 1.7, 3, 'EU'],
  ['MAD', 'Barajas', 'Madrid', 'ES', 40.47, -3.56, 6.8, 0.95, 1.3, 5, 'EU'],
  ['BCN', 'El Prat', 'Barcelona', 'ES', 41.3, 2.08, 5.6, 0.95, 1.7, 5, 'EU'],
  ['PMI', 'Palma de Mallorca', 'Palma', 'ES', 39.55, 2.74, 0.9, 0.9, 1.9, 4, 'EU'],
  ['AGP', 'Málaga', 'Málaga', 'ES', 36.67, -4.5, 1.6, 0.85, 1.7, 4, 'EU'],
  ['LIS', 'Humberto Delgado', 'Lisbon', 'PT', 38.77, -9.13, 2.9, 0.8, 1.5, 4, 'EU'],
  ['FCO', 'Fiumicino', 'Rome', 'IT', 41.8, 12.25, 4.3, 0.95, 1.7, 5, 'EU'],
  ['MXP', 'Malpensa', 'Milan', 'IT', 45.63, 8.72, 5.0, 1.05, 1.1, 4, 'EU'],
  ['VCE', 'Marco Polo', 'Venice', 'IT', 45.51, 12.35, 0.9, 1.0, 1.7, 3, 'EU'],
  ['ATH', 'Eleftherios Venizelos', 'Athens', 'GR', 37.94, 23.94, 3.6, 0.7, 1.6, 4, 'EU'],
  ['IST', 'Istanbul', 'Istanbul', 'TR', 41.26, 28.74, 15.8, 0.45, 1.4, 5, 'EU'],
  ['AYT', 'Antalya', 'Antalya', 'TR', 36.9, 30.8, 1.4, 0.45, 1.9, 4, 'EU'],
  ['WAW', 'Chopin', 'Warsaw', 'PL', 52.17, 20.97, 3.1, 0.7, 0.8, 4, 'EU'],
  ['PRG', 'Václav Havel', 'Prague', 'CZ', 50.1, 14.26, 2.7, 0.85, 1.4, 4, 'EU'],
  ['BUD', 'Ferenc Liszt', 'Budapest', 'HU', 47.44, 19.26, 3.0, 0.7, 1.3, 4, 'EU'],
  ['OTP', 'Henri Coandă', 'Bucharest', 'RO', 44.57, 26.09, 2.3, 0.55, 0.6, 3, 'EU'],
  // Middle East
  ['DXB', 'Dubai Intl', 'Dubai', 'AE', 25.25, 55.36, 3.6, 1.3, 1.7, 5, 'ME'],
  ['AUH', 'Zayed Intl', 'Abu Dhabi', 'AE', 24.43, 54.65, 1.5, 1.4, 1.0, 4, 'ME'],
  ['DOH', 'Hamad Intl', 'Doha', 'QA', 25.27, 51.61, 2.4, 1.5, 0.9, 5, 'ME'],
  ['RUH', 'King Khalid', 'Riyadh', 'SA', 24.96, 46.7, 7.7, 0.8, 0.5, 4, 'ME'],
  ['JED', 'King Abdulaziz', 'Jeddah', 'SA', 21.68, 39.16, 4.7, 0.75, 1.3, 4, 'ME'],
  ['TLV', 'Ben Gurion', 'Tel Aviv', 'IL', 32.01, 34.89, 4.2, 1.1, 1.0, 4, 'ME'],
  // Africa
  ['CAI', 'Cairo Intl', 'Cairo', 'EG', 30.12, 31.41, 21.0, 0.25, 1.3, 4, 'AF'],
  ['ADD', 'Bole', 'Addis Ababa', 'ET', 8.98, 38.8, 5.5, 0.12, 0.4, 4, 'AF'],
  ['NBO', 'Jomo Kenyatta', 'Nairobi', 'KE', -1.32, 36.93, 5.0, 0.15, 0.9, 4, 'AF'],
  ['JNB', 'O. R. Tambo', 'Johannesburg', 'ZA', -26.14, 28.25, 10.0, 0.35, 0.7, 5, 'AF'],
  ['CPT', 'Cape Town Intl', 'Cape Town', 'ZA', -33.97, 18.6, 4.8, 0.35, 1.6, 4, 'AF'],
  ['LOS', 'Murtala Muhammed', 'Lagos', 'NG', 6.58, 3.32, 15.0, 0.18, 0.3, 4, 'AF'],
  ['CMN', 'Mohammed V', 'Casablanca', 'MA', 33.37, -7.59, 4.3, 0.3, 0.9, 4, 'AF'],
  ['RAK', 'Menara', 'Marrakech', 'MA', 31.61, -8.04, 1.0, 0.3, 1.7, 3, 'AF'],
  // Asia
  ['DEL', 'Indira Gandhi', 'Delhi', 'IN', 28.56, 77.1, 32.0, 0.15, 0.9, 5, 'AS'],
  ['BOM', 'Chhatrapati Shivaji', 'Mumbai', 'IN', 19.09, 72.87, 24.0, 0.18, 0.8, 5, 'AS'],
  ['BLR', 'Kempegowda', 'Bengaluru', 'IN', 13.2, 77.71, 13.0, 0.2, 0.5, 4, 'AS'],
  ['MLE', 'Velana', 'Malé', 'MV', 4.19, 73.53, 0.2, 0.7, 2.0, 3, 'AS'],
  ['BKK', 'Suvarnabhumi', 'Bangkok', 'TH', 13.69, 100.75, 17.0, 0.35, 1.7, 5, 'AS'],
  ['HKT', 'Phuket', 'Phuket', 'TH', 8.11, 98.31, 0.5, 0.4, 1.9, 3, 'AS'],
  ['SIN', 'Changi', 'Singapore', 'SG', 1.36, 103.99, 5.9, 1.6, 1.4, 5, 'AS'],
  ['KUL', 'Kuala Lumpur Intl', 'Kuala Lumpur', 'MY', 2.75, 101.71, 8.6, 0.5, 1.1, 5, 'AS'],
  ['CGK', 'Soekarno–Hatta', 'Jakarta', 'ID', -6.13, 106.66, 33.0, 0.2, 0.6, 5, 'AS'],
  ['DPS', 'Ngurah Rai', 'Bali', 'ID', -8.75, 115.17, 1.0, 0.35, 2.0, 4, 'AS'],
  ['MNL', 'Ninoy Aquino', 'Manila', 'PH', 14.51, 121.02, 25.0, 0.2, 0.7, 5, 'AS'],
  ['SGN', 'Tân Sơn Nhất', 'Ho Chi Minh City', 'VN', 10.82, 106.66, 14.0, 0.2, 0.9, 4, 'AS'],
  ['HAN', 'Nội Bài', 'Hanoi', 'VN', 21.22, 105.81, 8.5, 0.2, 0.9, 4, 'AS'],
  ['HKG', 'Hong Kong Intl', 'Hong Kong', 'HK', 22.31, 113.91, 7.5, 1.2, 1.4, 5, 'AS'],
  ['TPE', 'Taoyuan', 'Taipei', 'TW', 25.08, 121.23, 7.0, 0.9, 1.0, 5, 'AS'],
  ['PEK', 'Capital Intl', 'Beijing', 'CN', 40.08, 116.6, 22.0, 0.45, 1.1, 5, 'AS'],
  ['PVG', 'Pudong', 'Shanghai', 'CN', 31.14, 121.81, 25.0, 0.55, 1.1, 5, 'AS'],
  ['CAN', 'Baiyun', 'Guangzhou', 'CN', 23.39, 113.3, 19.0, 0.45, 0.7, 5, 'AS'],
  ['SZX', "Bao'an", 'Shenzhen', 'CN', 22.64, 113.81, 17.0, 0.6, 0.6, 4, 'AS'],
  ['CTU', 'Shuangliu', 'Chengdu', 'CN', 30.58, 103.95, 16.0, 0.35, 0.9, 4, 'AS'],
  ['ICN', 'Incheon', 'Seoul', 'KR', 37.46, 126.44, 25.0, 1.0, 1.2, 5, 'AS'],
  ['HND', 'Haneda', 'Tokyo', 'JP', 35.55, 139.78, 25.0, 1.05, 1.4, 5, 'AS'],
  ['NRT', 'Narita', 'Tokyo', 'JP', 35.77, 140.39, 12.0, 1.0, 1.1, 4, 'AS'],
  ['KIX', 'Kansai', 'Osaka', 'JP', 34.43, 135.24, 19.0, 0.95, 1.4, 4, 'AS'],
  // Oceania
  ['SYD', 'Kingsford Smith', 'Sydney', 'AU', -33.95, 151.18, 5.3, 1.3, 1.4, 5, 'OC'],
  ['MEL', 'Tullamarine', 'Melbourne', 'AU', -37.67, 144.84, 5.2, 1.25, 1.1, 5, 'OC'],
  ['BNE', 'Brisbane', 'Brisbane', 'AU', -27.38, 153.12, 2.6, 1.2, 1.2, 4, 'OC'],
  ['PER', 'Perth', 'Perth', 'AU', -31.94, 115.97, 2.2, 1.3, 0.9, 4, 'OC'],
  ['AKL', 'Auckland', 'Auckland', 'NZ', -37.01, 174.79, 1.7, 1.0, 1.4, 4, 'OC'],
  ['NAN', 'Nadi Intl', 'Nadi', 'FJ', -17.76, 177.44, 0.3, 0.25, 1.9, 2, 'OC'],
];

export const AIRPORTS: Airport[] = rows.map(([iata, name, city, country, lat, lon, pop, wealth, tourism, size, region]) => ({
  iata, name, city, country, lat, lon, pop, wealth, tourism, size, region,
}));

export const AIRPORT_BY_CODE: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.iata, a]));

export function airport(code: string): Airport {
  const a = AIRPORT_BY_CODE[code];
  if (!a) throw new Error(`Unknown airport ${code}`);
  return a;
}

// Civil aircraft registration prefixes, used to give the player's fleet
// realistic tail numbers for their home country.
export const REG_PREFIX: Record<string, string> = {
  US: 'N', PR: 'N', CA: 'C-', MX: 'XA-', PA: 'HP-', CO: 'HK-', PE: 'OB-', BR: 'PR-', AR: 'LV-', CL: 'CC-',
  GB: 'G-', IE: 'EI-', FR: 'F-', NL: 'PH-', BE: 'OO-', DE: 'D-', CH: 'HB-', AT: 'OE-', DK: 'OY-', SE: 'SE-',
  NO: 'LN-', FI: 'OH-', IS: 'TF-', ES: 'EC-', PT: 'CS-', IT: 'I-', GR: 'SX-', TR: 'TC-', PL: 'SP-', CZ: 'OK-',
  HU: 'HA-', RO: 'YR-', AE: 'A6-', QA: 'A7-', SA: 'HZ-', IL: '4X-', EG: 'SU-', ET: 'ET-', KE: '5Y-', ZA: 'ZS-',
  NG: '5N-', MA: 'CN-', IN: 'VT-', MV: '8Q-', TH: 'HS-', SG: '9V-', MY: '9M-', ID: 'PK-', PH: 'RP-C', VN: 'VN-',
  HK: 'B-', TW: 'B-', CN: 'B-', KR: 'HL', JP: 'JA', AU: 'VH-', NZ: 'ZK-', FJ: 'DQ-',
};
