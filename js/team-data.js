/**
 * Comprehensive team data: country flags (Swedish names) + club logos.
 *
 * Country flags use flagcdn.com: https://flagcdn.com/24x18/{code}.png
 * Club logos use football-data.org crests: https://crests.football-data.org/{id}.svg
 */

// ── Country flag codes (Swedish name → ISO 3166 code for flagcdn) ─────
export const countryFlags = {
    // A
    "Afghanistan": "af", "Albanien": "al", "Algeriet": "dz", "Andorra": "ad",
    "Angola": "ao", "Argentina": "ar", "Armenien": "am", "Australien": "au",
    "Azerbajdzjan": "az",
    // B
    "Bahrain": "bh", "Bangladesh": "bd", "Belgien": "be", "Benin": "bj",
    "Bolivia": "bo", "Bosnien och Hercegovina": "ba", "Bosnien": "ba",
    "Botswana": "bw", "Brasilien": "br", "Bulgarien": "bg", "Burkina Faso": "bf",
    "Burundi": "bi",
    // C
    "Centralafrikanska republiken": "cf", "Chile": "cl", "Colombia": "co",
    "Costa Rica": "cr", "Curaçao": "cw", "Cypern": "cy",
    // D
    "Danmark": "dk", "Demokratiska republiken Kongo": "cd", "DR Kongo": "cd", "Dominikanska republiken": "do",
    // E
    "Ecuador": "ec", "Egypten": "eg", "El Salvador": "sv", "Elfenbenskusten": "ci",
    "England": "gb-eng", "Eritrea": "er", "Estland": "ee", "Etiopien": "et",
    // F
    "Filippinerna": "ph", "Finland": "fi", "Frankrike": "fr", "Förenade Arabemiraten": "ae",
    // G
    "Gabon": "ga", "Gambia": "gm", "Georgien": "ge", "Ghana": "gh",
    "Grekland": "gr", "Guatemala": "gt", "Guinea": "gn", "Guinea-Bissau": "gw",
    // H
    "Haiti": "ht", "Honduras": "hn", "Hongkong": "hk", "Ungern": "hu",
    // I
    "Indien": "in", "Indonesien": "id", "Irak": "iq", "Iran": "ir",
    "Irland": "ie", "Island": "is", "Israel": "il", "Italien": "it",
    // J
    "Jamaica": "jm", "Japan": "jp", "Jordanien": "jo",
    // K
    "Kamerun": "cm", "Kanada": "ca", "Kap Verde": "cv", "Kazakstan": "kz",
    "Kenya": "ke", "Kina": "cn", "Kirgizistan": "kg", "Kongo": "cg",
    "Kosovo": "xk", "Kroatien": "hr", "Kuba": "cu", "Kuwait": "kw",
    // L
    "Laos": "la", "Lettland": "lv", "Libanon": "lb", "Libyen": "ly",
    "Liechtenstein": "li", "Litauen": "lt", "Luxemburg": "lu",
    // M
    "Madagaskar": "mg", "Malawi": "mw", "Malaysia": "my", "Mali": "ml",
    "Malta": "mt", "Marocko": "ma", "Mauretanien": "mr", "Mauritius": "mu",
    "Mexiko": "mx", "Moldavien": "md", "Montenegro": "me", "Moçambique": "mz",
    "Myanmar": "mm",
    // N
    "Namibia": "na", "Nederländerna": "nl", "Nepal": "np", "Nicaragua": "ni",
    "Niger": "ne", "Nigeria": "ng", "Nordirland": "gb-nir", "Nordkorea": "kp",
    "Nordmakedonien": "mk", "Norge": "no", "Nya Zeeland": "nz",
    // O
    "Oman": "om",
    // P
    "Pakistan": "pk", "Palestina": "ps", "Panama": "pa", "Paraguay": "py",
    "Peru": "pe", "Polen": "pl", "Portugal": "pt",
    // Q
    "Qatar": "qa",
    // R
    "Rumänien": "ro", "Ryssland": "ru", "Rwanda": "rw",
    // S
    "Saudiarabien": "sa", "Schweiz": "ch", "Senegal": "sn", "Serbien": "rs",
    "Sierra Leone": "sl", "Singapore": "sg", "Skottland": "gb-sct",
    "Slovakien": "sk", "Slovenien": "si", "Somalia": "so", "Spanien": "es",
    "Sri Lanka": "lk", "Storbritannien": "gb", "Sudan": "sd",
    "Sverige": "se", "Sydafrika": "za", "Sydkorea": "kr", "Sydsudan": "ss",
    "Syrien": "sy",
    // T
    "Tadzjikistan": "tj", "Taiwan": "tw", "Tanzania": "tz", "Thailand": "th",
    "Tjeckien": "cz", "Togo": "tg", "Trinidad och Tobago": "tt",
    "Tunisien": "tn", "Turkiet": "tr", "Turkmenistan": "tm",
    "Tyskland": "de",
    // U
    "Uganda": "ug", "Ukraina": "ua", "Uruguay": "uy",
    "USA": "us", "Uzbekistan": "uz",
    // V
    "Venezuela": "ve", "Vietnam": "vn",
    // W
    "Wales": "gb-wls",
    // Z
    "Zambia": "zm", "Zimbabwe": "zw",
    // Ö
    "Österrike": "at",
    // Alternativa stavningar
    "Sydkorea": "kr", "Nordkorea": "kp",
};

// ── Club logo IDs (club name → football-data.org crest ID) ────────────
// URL: https://crests.football-data.org/{id}.svg
export const clubCrestIds = {
    // England - Premier League
    "Arsenal": 57, "Aston Villa": 58, "Chelsea": 61, "Everton": 62,
    "Liverpool": 64, "Manchester City": 65, "Manchester United": 66,
    "Newcastle": 67, "Tottenham": 73, "West Ham": 563,
    "Brighton": 397, "Wolves": 76, "Nottingham Forest": 351,
    "Bournemouth": 1044, "Fulham": 63, "Crystal Palace": 354,
    "Brentford": 402,
    // Spain - La Liga
    "Barcelona": 81, "Real Madrid": 86, "Atlético Madrid": 78,
    "Athletic Bilbao": 77, "Real Sociedad": 90, "Villarreal": 94,
    "Real Betis": 80, "Sevilla": 559, "Girona": 298,
    "Valencia": 95, "Celta Vigo": 558, "Mallorca": 89,
    // Germany - Bundesliga
    "Bayern München": 5, "Borussia Dortmund": 4, "Bayer Leverkusen": 3,
    "RB Leipzig": 721, "Eintracht Frankfurt": 19, "Freiburg": 17,
    "VfB Stuttgart": 10, "Wolfsburg": 11, "Hoffenheim": 2,
    "Union Berlin": 28, "Werder Bremen": 12, "Mainz": 15,
    // Italy - Serie A
    "Inter": 108, "AC Milan": 98, "Juventus": 109,
    "Napoli": 113, "Roma": 100, "Lazio": 110,
    "Atalanta": 102, "Fiorentina": 99, "Bologna": 103,
    "Torino": 586, "Monza": 5890, "Udinese": 115,
    // France - Ligue 1
    "PSG": 524, "Paris Saint-Germain": 524, "Marseille": 516,
    "Monaco": 548, "Lyon": 523, "Lille": 521,
    "Nice": 522, "Lens": 546, "Rennes": 529,
    "Strasbourg": 525, "Toulouse": 511, "Brest": 512,
    // Portugal
    "Benfica": 1903, "Porto": 503, "Sporting CP": 498, "Sporting Lissabon": 498,
    "Braga": 5613,
    // Netherlands
    "Ajax": 678, "PSV": 674, "Feyenoord": 675,
    // Belgium
    "Club Brugge": 851,
    // Scotland
    "Celtic": 732, "Rangers": 738,
    // Austria
    "Red Bull Salzburg": 1877, "Salzburg": 1877, "Sturm Graz": 6902,
    // Switzerland
    "Young Boys": 1871,
    // Turkey
    "Galatasaray": 610, "Fenerbahçe": 611, "Besiktas": 612,
    // Greece
    "Olympiakos": 708,
    // Ukraine
    "Shakhtar Donetsk": 660,
    // Czech Republic
    "Sparta Prag": 2071, "Slavia Prag": 6575,
    // Croatia
    "Dinamo Zagreb": 755,
    // Serbia
    "Röda Stjärnan": 7283, "Crvena Zvezda": 7283,
    // Denmark
    "FC Köpenhamn": 1876, "København": 1876,
    // Sweden
    "Malmö FF": 1886,
    // Norway
    "Bodø/Glimt": 6806,
};

// ── Combined lookup: check country first, then club ───────────────────
export function getTeamImageUrl(teamName, size) {
    const sz = size || '24x18';
    const flagCode = countryFlags[teamName];
    if (flagCode) return `https://flagcdn.com/${sz}/${flagCode}.png`;

    const crestId = clubCrestIds[teamName];
    if (crestId) return `https://crests.football-data.org/${crestId}.svg`;

    return null;
}

/**
 * Returns an <img> tag for the team (country flag or club crest).
 * Falls back to 🌍 if unknown.
 */
export function teamImg(teamName, opts) {
    const { size = 24, height = 18, style = '' } = opts || {};
    const flagCode = countryFlags[teamName];
    if (flagCode) {
        return `<img src="https://flagcdn.com/${size}x${height}/${flagCode}.png" style="vertical-align:-4px; margin:0 6px; border-radius:2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); ${style}" width="${size}" height="${height}" alt="">`;
    }
    const crestId = clubCrestIds[teamName];
    if (crestId) {
        return `<img src="https://crests.football-data.org/${crestId}.svg" style="vertical-align:-4px; margin:0 6px; ${style}" width="${size}" height="${size}" alt="">`;
    }
    return '🌍 ';
}

/**
 * Returns an <img> tag for large display (champion screen, etc.)
 */
export function teamImgLarge(teamName) {
    const flagCode = countryFlags[teamName];
    if (flagCode) {
        return `<img src="https://flagcdn.com/40x30/${flagCode}.png" style="vertical-align:-5px; margin-right:10px; border-radius:2px;" width="40" height="30" alt="">`;
    }
    const crestId = clubCrestIds[teamName];
    if (crestId) {
        return `<img src="https://crests.football-data.org/${crestId}.svg" style="vertical-align:-5px; margin-right:10px;" width="40" height="40" alt="">`;
    }
    return '🌍 ';
}

/**
 * Returns full autocomplete list: all countries + all clubs
 */
export function getAllTeamNames() {
    return [...new Set([...Object.keys(countryFlags), ...Object.keys(clubCrestIds)])].sort();
}

/**
 * Search teams by prefix (for autocomplete)
 */
export function searchTeams(query) {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    return getAllTeamNames().filter(name => name.toLowerCase().includes(q));
}
