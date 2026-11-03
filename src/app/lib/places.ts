// India's grid is operated as five regional grids; the India Energy Atlas
// serves carbon intensity per region ("zone"), so any place only needs to
// resolve to its state, and the state to its region. The two island UTs
// (Andaman & Nicobar, Lakshadweep) aren't connected to the national grid,
// so they aren't offered.
export type Zone = "northern" | "western" | "southern" | "eastern" | "north-eastern";

export const ZONE_LABELS: Record<Zone, string> = {
  northern: "Northern grid",
  western: "Western grid",
  southern: "Southern grid",
  eastern: "Eastern grid",
  "north-eastern": "North-Eastern grid",
};

// `lat`/`lon` are the state capital's — only used for the coordinate-based
// Electricity Maps fallback, so the user's own position never leaves the device.
export const STATES: Record<string, { name: string; zone: Zone; lat: number; lon: number }> = {
  "andhra-pradesh": { name: "Andhra Pradesh", zone: "southern", lat: 16.51, lon: 80.52 },
  "arunachal-pradesh": { name: "Arunachal Pradesh", zone: "north-eastern", lat: 27.08, lon: 93.61 },
  assam: { name: "Assam", zone: "north-eastern", lat: 26.14, lon: 91.79 },
  bihar: { name: "Bihar", zone: "eastern", lat: 25.59, lon: 85.14 },
  chandigarh: { name: "Chandigarh", zone: "northern", lat: 30.73, lon: 76.78 },
  chhattisgarh: { name: "Chhattisgarh", zone: "western", lat: 21.25, lon: 81.63 },
  "dadra-and-nagar-haveli-and-daman-and-diu": { name: "Dadra and Nagar Haveli and Daman and Diu", zone: "western", lat: 20.4, lon: 72.83 },
  delhi: { name: "Delhi", zone: "northern", lat: 28.61, lon: 77.21 },
  goa: { name: "Goa", zone: "western", lat: 15.49, lon: 73.83 },
  gujarat: { name: "Gujarat", zone: "western", lat: 23.22, lon: 72.65 },
  haryana: { name: "Haryana", zone: "northern", lat: 30.73, lon: 76.78 },
  "himachal-pradesh": { name: "Himachal Pradesh", zone: "northern", lat: 31.1, lon: 77.17 },
  "jammu-and-kashmir": { name: "Jammu and Kashmir", zone: "northern", lat: 34.08, lon: 74.8 },
  jharkhand: { name: "Jharkhand", zone: "eastern", lat: 23.34, lon: 85.31 },
  karnataka: { name: "Karnataka", zone: "southern", lat: 12.97, lon: 77.59 },
  kerala: { name: "Kerala", zone: "southern", lat: 8.52, lon: 76.94 },
  ladakh: { name: "Ladakh", zone: "northern", lat: 34.15, lon: 77.58 },
  "madhya-pradesh": { name: "Madhya Pradesh", zone: "western", lat: 23.26, lon: 77.41 },
  maharashtra: { name: "Maharashtra", zone: "western", lat: 19.08, lon: 72.88 },
  manipur: { name: "Manipur", zone: "north-eastern", lat: 24.82, lon: 93.94 },
  meghalaya: { name: "Meghalaya", zone: "north-eastern", lat: 25.58, lon: 91.89 },
  mizoram: { name: "Mizoram", zone: "north-eastern", lat: 23.73, lon: 92.72 },
  nagaland: { name: "Nagaland", zone: "north-eastern", lat: 25.67, lon: 94.11 },
  odisha: { name: "Odisha", zone: "eastern", lat: 20.3, lon: 85.82 },
  puducherry: { name: "Puducherry", zone: "southern", lat: 11.94, lon: 79.81 },
  punjab: { name: "Punjab", zone: "northern", lat: 30.73, lon: 76.78 },
  rajasthan: { name: "Rajasthan", zone: "northern", lat: 26.91, lon: 75.79 },
  sikkim: { name: "Sikkim", zone: "eastern", lat: 27.33, lon: 88.61 },
  "tamil-nadu": { name: "Tamil Nadu", zone: "southern", lat: 13.08, lon: 80.27 },
  telangana: { name: "Telangana", zone: "southern", lat: 17.39, lon: 78.49 },
  tripura: { name: "Tripura", zone: "north-eastern", lat: 23.83, lon: 91.29 },
  "uttar-pradesh": { name: "Uttar Pradesh", zone: "northern", lat: 26.85, lon: 80.95 },
  uttarakhand: { name: "Uttarakhand", zone: "northern", lat: 30.32, lon: 78.03 },
  "west-bengal": { name: "West Bengal", zone: "eastern", lat: 22.57, lon: 88.36 },
};

export type Place = { name: string; state: string };

// [name, state slug, lat, lon, other names people search by]
type PlaceRow = [string, string, number, number, string[]?];
const ROWS: PlaceRow[] = [
  ["Visakhapatnam", "andhra-pradesh", 17.69, 83.22, ["Vizag"]], ["Vijayawada", "andhra-pradesh", 16.51, 80.65], ["Guntur", "andhra-pradesh", 16.31, 80.44], ["Nellore", "andhra-pradesh", 14.44, 79.99], ["Kurnool", "andhra-pradesh", 15.83, 78.04], ["Tirupati", "andhra-pradesh", 13.63, 79.42], ["Kakinada", "andhra-pradesh", 16.99, 82.25], ["Rajahmundry", "andhra-pradesh", 17.0, 81.8, ["Rajamahendravaram"]], ["Kadapa", "andhra-pradesh", 14.47, 78.82], ["Anantapur", "andhra-pradesh", 14.68, 77.6], ["Amaravati", "andhra-pradesh", 16.51, 80.52], ["Eluru", "andhra-pradesh", 16.71, 81.1], ["Ongole", "andhra-pradesh", 15.5, 80.05], ["Chittoor", "andhra-pradesh", 13.22, 79.1], ["Srikakulam", "andhra-pradesh", 18.3, 83.9], ["Vizianagaram", "andhra-pradesh", 18.11, 83.4],
  ["Itanagar", "arunachal-pradesh", 27.08, 93.61], ["Pasighat", "arunachal-pradesh", 28.07, 95.33], ["Tawang", "arunachal-pradesh", 27.59, 91.86],
  ["Guwahati", "assam", 26.14, 91.74, ["Dispur"]], ["Dibrugarh", "assam", 27.47, 94.91], ["Silchar", "assam", 24.83, 92.78], ["Jorhat", "assam", 26.75, 94.2], ["Tezpur", "assam", 26.63, 92.8], ["Nagaon", "assam", 26.35, 92.68], ["Tinsukia", "assam", 27.49, 95.36],
  ["Patna", "bihar", 25.59, 85.14], ["Gaya", "bihar", 24.79, 85.0], ["Bhagalpur", "bihar", 25.24, 86.97], ["Muzaffarpur", "bihar", 26.12, 85.39], ["Darbhanga", "bihar", 26.15, 85.9], ["Purnia", "bihar", 25.78, 87.47], ["Arrah", "bihar", 25.56, 84.66], ["Begusarai", "bihar", 25.42, 86.13],
  ["Chandigarh", "chandigarh", 30.73, 76.78],
  ["Raipur", "chhattisgarh", 21.25, 81.63], ["Bhilai", "chhattisgarh", 21.21, 81.38], ["Bilaspur", "chhattisgarh", 22.08, 82.14], ["Korba", "chhattisgarh", 22.36, 82.75], ["Durg", "chhattisgarh", 21.19, 81.28], ["Rajnandgaon", "chhattisgarh", 21.1, 81.03], ["Jagdalpur", "chhattisgarh", 19.07, 82.03],
  ["Silvassa", "dadra-and-nagar-haveli-and-daman-and-diu", 20.27, 73.02], ["Daman", "dadra-and-nagar-haveli-and-daman-and-diu", 20.4, 72.83], ["Diu", "dadra-and-nagar-haveli-and-daman-and-diu", 20.71, 70.99],
  ["New Delhi", "delhi", 28.61, 77.21, ["Delhi"]],
  ["Panaji", "goa", 15.49, 73.83, ["Panjim"]], ["Margao", "goa", 15.28, 73.96, ["Madgaon"]], ["Vasco da Gama", "goa", 15.4, 73.81], ["Mapusa", "goa", 15.59, 73.81],
  ["Ahmedabad", "gujarat", 23.02, 72.57], ["Surat", "gujarat", 21.17, 72.83], ["Vadodara", "gujarat", 22.31, 73.18, ["Baroda"]], ["Rajkot", "gujarat", 22.3, 70.8], ["Gandhinagar", "gujarat", 23.22, 72.65], ["Bhavnagar", "gujarat", 21.76, 72.15], ["Jamnagar", "gujarat", 22.47, 70.06], ["Junagadh", "gujarat", 21.52, 70.46], ["Anand", "gujarat", 22.56, 72.95], ["Bhuj", "gujarat", 23.24, 69.67], ["Vapi", "gujarat", 20.37, 72.9], ["Navsari", "gujarat", 20.95, 72.92], ["Gandhidham", "gujarat", 23.08, 70.13], ["Mehsana", "gujarat", 23.6, 72.37],
  ["Gurugram", "haryana", 28.46, 77.03, ["Gurgaon"]], ["Faridabad", "haryana", 28.41, 77.32], ["Panipat", "haryana", 29.39, 76.97], ["Ambala", "haryana", 30.38, 76.78], ["Karnal", "haryana", 29.69, 76.99], ["Hisar", "haryana", 29.15, 75.72], ["Rohtak", "haryana", 28.9, 76.61], ["Sonipat", "haryana", 28.99, 77.02], ["Yamunanagar", "haryana", 30.13, 77.29], ["Panchkula", "haryana", 30.69, 76.86],
  ["Shimla", "himachal-pradesh", 31.1, 77.17], ["Dharamshala", "himachal-pradesh", 32.22, 76.32], ["Manali", "himachal-pradesh", 32.24, 77.19], ["Mandi", "himachal-pradesh", 31.71, 76.93], ["Solan", "himachal-pradesh", 30.9, 77.1], ["Kullu", "himachal-pradesh", 31.96, 77.11],
  ["Srinagar", "jammu-and-kashmir", 34.08, 74.8], ["Jammu", "jammu-and-kashmir", 32.73, 74.86], ["Anantnag", "jammu-and-kashmir", 33.73, 75.15], ["Baramulla", "jammu-and-kashmir", 34.2, 74.34],
  ["Ranchi", "jharkhand", 23.34, 85.31], ["Jamshedpur", "jharkhand", 22.8, 86.2], ["Dhanbad", "jharkhand", 23.8, 86.43], ["Bokaro", "jharkhand", 23.67, 86.15], ["Hazaribagh", "jharkhand", 23.99, 85.36], ["Deoghar", "jharkhand", 24.48, 86.7],
  ["Bengaluru", "karnataka", 12.97, 77.59, ["Bangalore"]], ["Mysuru", "karnataka", 12.3, 76.64, ["Mysore"]], ["Hubballi", "karnataka", 15.36, 75.12, ["Hubli"]], ["Mangaluru", "karnataka", 12.91, 74.86, ["Mangalore"]], ["Belagavi", "karnataka", 15.85, 74.5, ["Belgaum"]], ["Kalaburagi", "karnataka", 17.33, 76.83, ["Gulbarga"]], ["Davanagere", "karnataka", 14.46, 75.92], ["Ballari", "karnataka", 15.14, 76.92, ["Bellary"]], ["Vijayapura", "karnataka", 16.83, 75.71, ["Bijapur"]], ["Shivamogga", "karnataka", 13.93, 75.57, ["Shimoga"]], ["Tumakuru", "karnataka", 13.34, 77.1, ["Tumkur"]], ["Udupi", "karnataka", 13.34, 74.75], ["Hassan", "karnataka", 13.0, 76.1], ["Raichur", "karnataka", 16.21, 77.36], ["Bidar", "karnataka", 17.91, 77.52], ["Dharwad", "karnataka", 15.46, 75.01],
  ["Thiruvananthapuram", "kerala", 8.52, 76.94, ["Trivandrum"]], ["Kochi", "kerala", 9.93, 76.27, ["Cochin", "Ernakulam"]], ["Kozhikode", "kerala", 11.26, 75.78, ["Calicut"]], ["Thrissur", "kerala", 10.53, 76.21, ["Trichur"]], ["Kollam", "kerala", 8.89, 76.61], ["Kannur", "kerala", 11.87, 75.37], ["Alappuzha", "kerala", 9.5, 76.34, ["Alleppey"]], ["Palakkad", "kerala", 10.78, 76.65], ["Kottayam", "kerala", 9.59, 76.52], ["Malappuram", "kerala", 11.07, 76.07],
  ["Leh", "ladakh", 34.15, 77.58], ["Kargil", "ladakh", 34.56, 76.13],
  ["Bhopal", "madhya-pradesh", 23.26, 77.41], ["Indore", "madhya-pradesh", 22.72, 75.86], ["Jabalpur", "madhya-pradesh", 23.18, 79.99], ["Gwalior", "madhya-pradesh", 26.22, 78.18], ["Ujjain", "madhya-pradesh", 23.18, 75.78], ["Sagar", "madhya-pradesh", 23.84, 78.74], ["Rewa", "madhya-pradesh", 24.53, 81.3], ["Satna", "madhya-pradesh", 24.6, 80.83], ["Ratlam", "madhya-pradesh", 23.33, 75.04], ["Dewas", "madhya-pradesh", 22.97, 76.05], ["Katni", "madhya-pradesh", 23.83, 80.4], ["Chhindwara", "madhya-pradesh", 22.06, 78.94],
  ["Mumbai", "maharashtra", 19.08, 72.88, ["Bombay"]], ["Pune", "maharashtra", 18.52, 73.86, ["Poona"]], ["Nagpur", "maharashtra", 21.15, 79.09], ["Nashik", "maharashtra", 20.0, 73.79], ["Thane", "maharashtra", 19.22, 72.98], ["Navi Mumbai", "maharashtra", 19.03, 73.03], ["Chhatrapati Sambhajinagar", "maharashtra", 19.88, 75.34, ["Aurangabad"]], ["Solapur", "maharashtra", 17.66, 75.91], ["Kolhapur", "maharashtra", 16.7, 74.24], ["Amravati", "maharashtra", 20.93, 77.75], ["Nanded", "maharashtra", 19.14, 77.32], ["Sangli", "maharashtra", 16.85, 74.58], ["Jalgaon", "maharashtra", 21.0, 75.56], ["Akola", "maharashtra", 20.7, 77.0], ["Latur", "maharashtra", 18.4, 76.56], ["Ahilyanagar", "maharashtra", 19.09, 74.74, ["Ahmednagar"]], ["Satara", "maharashtra", 17.68, 74.02], ["Ratnagiri", "maharashtra", 16.99, 73.3], ["Chandrapur", "maharashtra", 19.96, 79.3], ["Kalyan", "maharashtra", 19.24, 73.13], ["Vasai-Virar", "maharashtra", 19.39, 72.84],
  ["Imphal", "manipur", 24.82, 93.94],
  ["Shillong", "meghalaya", 25.58, 91.89], ["Tura", "meghalaya", 25.51, 90.22],
  ["Aizawl", "mizoram", 23.73, 92.72], ["Lunglei", "mizoram", 22.88, 92.73],
  ["Kohima", "nagaland", 25.67, 94.11], ["Dimapur", "nagaland", 25.91, 93.73],
  ["Bhubaneswar", "odisha", 20.3, 85.82], ["Cuttack", "odisha", 20.46, 85.88], ["Rourkela", "odisha", 22.26, 84.85], ["Berhampur", "odisha", 19.31, 84.79, ["Brahmapur"]], ["Sambalpur", "odisha", 21.47, 83.97], ["Puri", "odisha", 19.81, 85.83], ["Balasore", "odisha", 21.49, 86.93, ["Baleswar"]], ["Bhadrak", "odisha", 21.05, 86.5],
  ["Puducherry", "puducherry", 11.94, 79.81, ["Pondicherry"]], ["Karaikal", "puducherry", 10.93, 79.84],
  ["Ludhiana", "punjab", 30.9, 75.86], ["Amritsar", "punjab", 31.63, 74.87], ["Jalandhar", "punjab", 31.33, 75.58], ["Patiala", "punjab", 30.34, 76.39], ["Bathinda", "punjab", 30.21, 74.95], ["Mohali", "punjab", 30.7, 76.72, ["SAS Nagar"]], ["Pathankot", "punjab", 32.27, 75.65], ["Hoshiarpur", "punjab", 31.53, 75.91],
  ["Jaipur", "rajasthan", 26.91, 75.79], ["Jodhpur", "rajasthan", 26.24, 73.02], ["Udaipur", "rajasthan", 24.59, 73.71], ["Kota", "rajasthan", 25.21, 75.86], ["Ajmer", "rajasthan", 26.45, 74.64], ["Bikaner", "rajasthan", 28.02, 73.31], ["Alwar", "rajasthan", 27.55, 76.63], ["Bhilwara", "rajasthan", 25.35, 74.63], ["Sikar", "rajasthan", 27.61, 75.14], ["Jaisalmer", "rajasthan", 26.92, 70.91], ["Bharatpur", "rajasthan", 27.22, 77.49], ["Sri Ganganagar", "rajasthan", 29.9, 73.88],
  ["Gangtok", "sikkim", 27.33, 88.61], ["Namchi", "sikkim", 27.17, 88.36],
  ["Chennai", "tamil-nadu", 13.08, 80.27, ["Madras"]], ["Coimbatore", "tamil-nadu", 11.02, 76.96, ["Kovai"]], ["Madurai", "tamil-nadu", 9.93, 78.12], ["Tiruchirappalli", "tamil-nadu", 10.79, 78.7, ["Trichy"]], ["Salem", "tamil-nadu", 11.66, 78.15], ["Tirunelveli", "tamil-nadu", 8.71, 77.76], ["Tiruppur", "tamil-nadu", 11.11, 77.34], ["Vellore", "tamil-nadu", 12.92, 79.13], ["Erode", "tamil-nadu", 11.34, 77.72], ["Thoothukudi", "tamil-nadu", 8.76, 78.13, ["Tuticorin"]], ["Thanjavur", "tamil-nadu", 10.79, 79.14, ["Tanjore"]], ["Dindigul", "tamil-nadu", 10.36, 77.98], ["Hosur", "tamil-nadu", 12.74, 77.83], ["Kanchipuram", "tamil-nadu", 12.83, 79.7], ["Nagercoil", "tamil-nadu", 8.18, 77.41], ["Cuddalore", "tamil-nadu", 11.75, 79.77], ["Karur", "tamil-nadu", 10.96, 78.08],
  ["Hyderabad", "telangana", 17.39, 78.49], ["Secunderabad", "telangana", 17.44, 78.5], ["Warangal", "telangana", 17.97, 79.59], ["Nizamabad", "telangana", 18.67, 78.09], ["Karimnagar", "telangana", 18.44, 79.13], ["Khammam", "telangana", 17.25, 80.15], ["Mahbubnagar", "telangana", 16.74, 78.0], ["Ramagundam", "telangana", 18.76, 79.47], ["Nalgonda", "telangana", 17.05, 79.27],
  ["Agartala", "tripura", 23.83, 91.29],
  ["Lucknow", "uttar-pradesh", 26.85, 80.95], ["Kanpur", "uttar-pradesh", 26.45, 80.33], ["Ghaziabad", "uttar-pradesh", 28.67, 77.45], ["Agra", "uttar-pradesh", 27.18, 78.01], ["Varanasi", "uttar-pradesh", 25.32, 82.97, ["Banaras", "Benares"]], ["Meerut", "uttar-pradesh", 28.98, 77.71], ["Prayagraj", "uttar-pradesh", 25.44, 81.85, ["Allahabad"]], ["Noida", "uttar-pradesh", 28.54, 77.39], ["Greater Noida", "uttar-pradesh", 28.47, 77.5], ["Bareilly", "uttar-pradesh", 28.37, 79.43], ["Aligarh", "uttar-pradesh", 27.88, 78.08], ["Moradabad", "uttar-pradesh", 28.84, 78.77], ["Gorakhpur", "uttar-pradesh", 26.76, 83.37], ["Saharanpur", "uttar-pradesh", 29.96, 77.55], ["Jhansi", "uttar-pradesh", 25.45, 78.57], ["Mathura", "uttar-pradesh", 27.49, 77.67], ["Ayodhya", "uttar-pradesh", 26.8, 82.2], ["Firozabad", "uttar-pradesh", 27.15, 78.4], ["Muzaffarnagar", "uttar-pradesh", 29.47, 77.7], ["Shahjahanpur", "uttar-pradesh", 27.88, 79.91], ["Rampur", "uttar-pradesh", 28.81, 79.03],
  ["Dehradun", "uttarakhand", 30.32, 78.03], ["Haridwar", "uttarakhand", 29.95, 78.16], ["Haldwani", "uttarakhand", 29.22, 79.51], ["Roorkee", "uttarakhand", 29.87, 77.89], ["Rishikesh", "uttarakhand", 30.09, 78.27], ["Nainital", "uttarakhand", 29.38, 79.46], ["Rudrapur", "uttarakhand", 28.98, 79.4],
  ["Kolkata", "west-bengal", 22.57, 88.36, ["Calcutta"]], ["Howrah", "west-bengal", 22.59, 88.26], ["Durgapur", "west-bengal", 23.55, 87.32], ["Asansol", "west-bengal", 23.68, 86.98], ["Siliguri", "west-bengal", 26.73, 88.4], ["Bardhaman", "west-bengal", 23.23, 87.86, ["Burdwan"]], ["Kharagpur", "west-bengal", 22.35, 87.23], ["Haldia", "west-bengal", 22.03, 88.06], ["Malda", "west-bengal", 25.0, 88.14], ["Darjeeling", "west-bengal", 27.04, 88.26],
];

type IndexedPlace = Place & { lat: number; lon: number; search: string[] };
const PLACES: IndexedPlace[] = ROWS.map(([name, state, lat, lon, aliases = []]) => ({ name, state, lat, lon, search: [name, ...aliases].map(normalize) }));

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const DEFAULT_PLACE: Place = { name: "Chennai", state: "tamil-nadu" };

export function placeLabel(place: Place) {
  return `${place.name}, ${STATES[place.state]?.name ?? ""}`;
}

export function zoneOf(place: Place): Zone {
  return STATES[place.state]?.zone ?? "southern";
}

// A listed city's coordinates (e.g. to search for chargers around it), or null
// for anything not on the list.
export function knownPlaceCoordinates(place: Place): { lat: number; lon: number } | null {
  const match = PLACES.find((row) => row.name === place.name && row.state === place.state);
  return match ? { lat: match.lat, lon: match.lon } : null;
}

export function isPlace(value: unknown): value is Place {
  return Boolean(value && typeof value === "object" && typeof (value as Place).name === "string" && typeof (value as Place).state === "string" && Object.hasOwn(STATES, (value as Place).state));
}

// Name/alias prefix matches first, then matches anywhere in a name, then by
// state name ("karnataka" lists its cities). Capped for a short result list.
export function searchPlaces(query: string, limit = 8): Place[] {
  const q = normalize(query);
  if (!q) return [];
  const score = (place: IndexedPlace) => {
    if (place.search.some((term) => term.startsWith(q))) return 0;
    if (place.search.some((term) => term.includes(q))) return 1;
    if (normalize(STATES[place.state].name).startsWith(q)) return 2;
    return -1;
  };
  return PLACES.map((place) => ({ place, rank: score(place) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ place }) => ({ name: place.name, state: place.state }));
}

export const POPULAR_PLACES: Place[] = ["Mumbai", "New Delhi", "Bengaluru", "Chennai", "Hyderabad", "Kolkata", "Pune", "Ahmedabad"].map((name) => {
  const place = PLACES.find((candidate) => candidate.name === name)!;
  return { name: place.name, state: place.state };
});

// India's outline as India maps it (all of Jammu & Kashmir and Ladakh), as
// [lat, lon] clockwise from the sea off Kutch. The land borders are traced
// to within a few km, so Lahore, Kathmandu, Dhaka and Thimphu fall outside
// while Amritsar, Siliguri and Agartala fall inside; the coasts are drawn out
// at sea. The island UTs get boxes of their own (ISLANDS, below).
const OUTLINE: [number, number][] = [
  // Pakistan, up to the Karakoram
  [23.3, 67.9], [23.95, 68.2], [24.25, 68.75], [24.3, 69.6], [24.2, 70.3], [24.25, 71.05], [24.65, 71.1], [25.72, 70.24], [26.25, 69.85], [26.6, 69.45], [27.1, 69.6], [27.45, 69.95], [27.85, 70.2], [28.38, 71.25], [28.9, 72.25], [29.2, 73.05], [29.55, 73.3], [30.1, 73.55], [30.4, 73.85], [30.7, 74.25], [30.99, 74.52], [31.2, 74.53], [31.6, 74.57], [31.95, 74.85], [32.06, 75.0], [32.15, 75.3], [32.32, 75.42], [32.48, 75.15], [32.55, 74.62], [32.9, 74.35], [33.0, 73.65], [34.1, 73.42], [34.45, 73.4], [35.15, 74.05], [35.4, 73.4], [36.0, 72.5], [36.9, 73.4], [37.05, 74.5],
  // China, to Nepal
  [36.85, 75.4], [36.3, 76.1], [35.9, 76.8], [35.55, 77.8], [36.0, 78.5], [35.6, 80.25], [34.4, 79.55], [33.65, 79.45], [32.7, 79.5], [32.4, 78.75], [31.85, 78.75], [31.3, 79.05], [30.95, 79.45], [30.45, 80.25], [30.2, 81.0],
  // Nepal
  [29.85, 80.57], [29.56, 80.4], [29.43, 80.25], [29.05, 80.11], [28.97, 80.12], [28.8, 80.15], [28.65, 80.6], [28.35, 81.15], [28.04, 81.62], [27.52, 82.78], [27.48, 83.45], [27.48, 84.05], [27.3, 84.3], [26.995, 84.86], [26.76, 85.28], [26.63, 86.1], [26.5, 86.7], [26.42, 87.27], [26.35, 88.02], [26.65, 88.165], [26.9, 88.14], [27.1, 88.02], [27.75, 88.12],
  // China (Sikkim), Bhutan, China (Arunachal)
  [28.13, 88.6], [28.0, 88.85], [27.6, 88.85], [27.2, 88.85], [26.95, 88.92], [26.852, 89.38], [26.82, 89.9], [26.84, 90.48], [26.79, 91.5], [26.82, 92.1], [27.25, 91.95], [27.6, 91.65], [27.95, 91.65], [27.75, 92.0], [27.85, 92.4], [28.05, 92.8], [28.2, 93.3], [28.6, 94.0], [29.05, 94.45], [29.3, 95.2], [29.4, 95.5], [29.2, 96.05], [28.6, 96.5], [28.3, 97.15], [28.15, 97.35],
  // Myanmar
  [27.25, 97.25], [26.95, 96.95], [27.2, 96.55], [27.25, 96.17], [26.95, 95.7], [26.64, 95.05], [26.2, 95.15], [25.7, 95.1], [25.3, 94.75], [25.0, 94.6], [24.6, 94.6], [24.2, 94.29], [23.95, 93.8], [23.7, 93.45], [23.36, 93.4], [22.9, 93.25], [22.4, 93.2], [22.0, 93.05], [21.95, 92.7],
  // Bangladesh, round from Mizoram to the Sundarbans
  [22.9, 92.44], [23.5, 92.25], [23.15, 91.95], [22.95, 91.73], [23.2, 91.4], [23.85, 91.24], [24.15, 91.55], [24.3, 91.93], [24.42, 92.17], [24.75, 92.28], [24.88, 92.33], [24.9, 92.48], [25.15, 92.45], [25.18, 92.02], [25.17, 91.4], [25.17, 90.65], [25.17, 90.2], [25.17, 89.87], [25.55, 89.87], [25.97, 89.85], [26.2, 89.75], [26.05, 89.5], [26.3, 89.1], [26.42, 89.05], [26.3, 88.95], [26.3, 88.8], [26.63, 88.42], [26.45, 88.33], [26.2, 88.28], [25.95, 88.2], [25.6, 88.45], [25.28, 89.02], [25.1, 88.85], [25.05, 88.45], [24.84, 88.15], [24.5, 88.3], [24.3, 88.6], [24.1, 88.75], [23.85, 88.6], [23.5, 88.65], [23.2, 88.75], [23.04, 88.87], [22.7, 88.97], [22.2, 89.05], [21.6, 89.1],
  // The coast, offshore, round past Sri Lanka
  [21.2, 89.15], [20.6, 88.0], [19.5, 86.5], [17.6, 84.0], [16.0, 82.4], [15.0, 80.6], [12.5, 80.5], [10.35, 80.1], [9.15, 79.5], [8.3, 78.4], [7.8, 77.6], [8.1, 76.7], [9.5, 76.0], [11.0, 75.6], [12.5, 74.6], [14.5, 73.9], [16.0, 73.2], [18.0, 72.6], [19.5, 72.5], [20.5, 71.0], [20.6, 70.6], [21.4, 69.4], [22.4, 68.7], [23.0, 68.3],
];

// Andaman & Nicobar and Lakshadweep, as [minLat, maxLat, minLon, maxLon].
// They aren't offered as places, but a driver there isn't "outside India":
// detection still picks the nearest listed city for them to confirm.
const ISLANDS: [number, number, number, number][] = [[6.7, 13.8, 92.1, 94.0], [8.0, 12.5, 71.5, 74.1]];

// Inside that outline (or an island box): a ray from the point crosses its
// edge an odd number of times. A position in a neighbouring country is
// "outside India".
export function isInIndia(lat: number, lon: number) {
  if (!(lat >= 6.5 && lat <= 37.5 && lon >= 67.5 && lon <= 97.5)) return false;
  if (ISLANDS.some(([minLat, maxLat, minLon, maxLon]) => lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon)) return true;
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [latA, lonA] = OUTLINE[i], [latB, lonB] = OUTLINE[j];
    if (latA > lat !== latB > lat && lon < lonA + ((lat - latA) / (latB - latA)) * (lonB - lonA)) inside = !inside;
  }
  return inside;
}

// Nearest listed city by great-circle distance. Near a state border this can
// pick the neighbouring state's city, which is why the UI shows the result
// (with its grid region) for the user to confirm or change.
export function nearestPlace(lat: number, lon: number): Place & { km: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let best = PLACES[0];
  let bestKm = Infinity;
  for (const place of PLACES) {
    const dLat = toRad(place.lat - lat);
    const dLon = toRad(place.lon - lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(place.lat)) * Math.sin(dLon / 2) ** 2;
    const km = 6371 * 2 * Math.asin(Math.sqrt(a));
    if (km < bestKm) { bestKm = km; best = place; }
  }
  return { name: best.name, state: best.state, km: Math.round(bestKm) };
}

// Locations saved before search existed were one of three "City, India" strings.
export const LEGACY_LABELS: Record<string, Place> = {
  "Chennai, India": { name: "Chennai", state: "tamil-nadu" },
  "Bengaluru, India": { name: "Bengaluru", state: "karnataka" },
  "Mumbai, India": { name: "Mumbai", state: "maharashtra" },
};
