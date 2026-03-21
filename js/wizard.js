import { db, auth } from './config.js';
import { doc, getDocs, collection, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Flagg-hjälpare (med CDN för att fungera på alla datorer/telefoner)
export const flags = { "Mexiko": "mx", "Sydafrika": "za", "Sydkorea": "kr", "Kanada": "ca", "USA": "us", "Paraguay": "py", "Qatar": "qa", "Schweiz": "ch", "Brasilien": "br", "Marocko": "ma", "Haiti": "ht", "Skottland": "gb-sct", "Australien": "au", "Tyskland": "de", "Curaçao": "cw", "Nederländerna": "nl", "Japan": "jp", "Elfenbenskusten": "ci", "Ecuador": "ec", "Tunisien": "tn", "Spanien": "es", "Kap Verde": "cv", "Belgien": "be", "Egypten": "eg", "Saudiarabien": "sa", "Uruguay": "uy", "Iran": "ir", "Nya Zeeland": "nz", "Frankrike": "fr", "Senegal": "sn", "Norge": "no", "Argentina": "ar", "Algeriet": "dz", "Österrike": "at", "Jordanien": "jo", "Portugal": "pt", "England": "gb-eng", "Kroatien": "hr", "Ghana": "gh", "Panama": "pa", "Uzbekistan": "uz", "Colombia": "co" };
export const f = (t) => flags[t] ? `<img src="https://flagcdn.com/20x15/${flags[t]}.png" style="vertical-align:middle; margin-right:6px; border-radius:2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" width="20" height="15" alt="">` : '🌍 ';

const groupLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let currentIndex = 0;
let currentTeams = [];
let selFirst = null;
let selSecond = null;
let allMatches = []; // Laddas in via app.js

export function initWizard(matchesData) {
    allMatches = matchesData;
    loadGroup(currentIndex);

    // Koppla knappar (döptes om från spicy till smart i HTML också!)
    const btnSmart = document.getElementById('btn-smart-random');
    if(btnSmart) btnSmart.addEventListener('click', smartAutoFill);
    
    const btnSave = document.getElementById('btn-save-group');
    if(btnSave) btnSave.addEventListener('click', saveAndNext);
    
    const btnPrev = document.getElementById('btn-prev-group');
    if(btnPrev) btnPrev.addEventListener('click', () => { if(currentIndex > 0) loadGroup(--currentIndex); });
}

function loadGroup(index) {
    const letter = groupLetters[index];
    
    // UI-uppdateringar
    document.getElementById('wizard-title').textContent = `Grupp ${letter}`;
    document.getElementById('wizard-progress').style.width = `${((index + 1) / 12) * 100}%`;
    
    // Nollställ val
    selFirst = null; 
    selSecond = null;

    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    
    // Lista ut vilka 4 lag som ingår
    currentTeams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));
    
    renderTeamSelectors();
    
    const container = document.getElementById('wizard-matches');
    container.innerHTML = '';
    
    groupMatches.forEach(m => {
        container.innerHTML += `
            <div class="match-card">
                <div class="match-header"><span>${m.date || ''}</span></div>
                <div class="match-teams">
                    <span class="team-name home" id="wizNameHome-${m.id}">${f(m.homeTeam)}${m.homeTeam}</span>
                    <div class="score-input-group">
                        <input type="number" min="0" id="wizHome-${m.id}" class="score-input" placeholder="-" oninput="window.updateWizTable()"> 
                        <span style="color:#aaa; font-weight:bold; margin: 0 4px;">:</span> 
                        <input type="number" min="0" id="wizAway-${m.id}" class="score-input" placeholder="-" oninput="window.updateWizTable()">
                    </div>
                    <span class="team-name away" id="wizNameAway-${m.id}">${f(m.awayTeam)}${m.awayTeam}</span>
                </div>
            </div>`;
    });
    
    // Gör funktionen globalt tillgänglig för HTML 'oninput' attribut
    window.updateWizTable = updateWizardTable; 
    updateWizardTable(); // Skapa tabellen tom första gången
}

function renderTeamSelectors() {
    const container = document.getElementById('wizard-team-selectors');
    container.innerHTML = '';
    currentTeams.forEach(team => {
        let cls = team === selFirst ? 'rank-1' : (team === selSecond ? 'rank-2' : '');
        container.innerHTML += `<div class="team-chip ${cls}" onclick="window.toggleWizTeam('${team}')">${f(team)}${team}</div>`;
    });
}

// Görs global för att UI-klick ska fungera
window.toggleWizTeam = function(team) {
    if (selFirst === team) selFirst = null;
    else if (selSecond === team) selSecond = null;
    else if (!selFirst) selFirst = team;
    else if (!selSecond) selSecond = team;
    renderTeamSelectors();
}

// DEN SMARTA SLUMPGENERATORN
function smartAutoFill() {
    if (!selFirst || !selSecond) return alert("Klicka på två lag ovanför för att välja ettan och tvåan först!");

    const unselected = currentTeams.filter(t => t !== selFirst && t !== selSecond);
    const targetStandings = [selFirst, selSecond, unselected[0], unselected[1]]; // Målet!

    // 1. Skapa 4 "Anonyma Slots"
    let slots = [ {id: 0, pts:0, gd:0, gf:0}, {id: 1, pts:0, gd:0, gf:0}, {id: 2, pts:0, gd:0, gf:0}, {id: 3, pts:0, gd:0, gf:0} ];
    let simMatches = [ [0,1], [2,3], [0,2], [1,3], [0,3], [1,2] ]; // Alla möter alla
    let generatedScores = [];

    // 2. Generera slumpade resultat för alla 6 matcher
    simMatches.forEach(match => {
        const homeScore = Math.floor(Math.random() * 4);
        const awayScore = Math.floor(Math.random() * 4);
        generatedScores.push({ hId: match[0], aId: match[1], h: homeScore, a: awayScore });
        
        let h = slots[match[0]]; let a = slots[match[1]];
        h.gf += homeScore; a.gf += awayScore; h.gd += (homeScore-awayScore); a.gd += (awayScore-homeScore);
        if(homeScore > awayScore) h.pts += 3; else if(awayScore > homeScore) a.pts += 3; else { h.pts++; a.pts++; }
    });

    // 3. Sortera de anonyma slotsen för att se vilken slot som faktiskt "vann"
    slots.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    // 4. Mappa tillbaka! Slotten som vann får laget du valde som vinnare.
    let slotToTeamMap = {};
    slotToTeamMap[slots[0].id] = targetStandings[0];
    slotToTeamMap[slots[1].id] = targetStandings[1];
    slotToTeamMap[slots[2].id] = targetStandings[2];
    slotToTeamMap[slots[3].id] = targetStandings[3];

    // 5. Skriv ut resultaten i input-fälten
    const letter = groupLetters[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    groupMatches.forEach(m => {
        const simM = generatedScores.find(sim => 
            (slotToTeamMap[sim.hId] === m.homeTeam && slotToTeamMap[sim.aId] === m.awayTeam) ||
            (slotToTeamMap[sim.aId] === m.homeTeam && slotToTeamMap[sim.hId] === m.awayTeam)
        );

        if(simM) {
            if(slotToTeamMap[simM.hId] === m.homeTeam) {
                document.getElementById(`wizHome-${m.id}`).value = simM.h;
                document.getElementById(`wizAway-${m.id}`).value = simM.a;
            } else {
                document.getElementById(`wizHome-${m.id}`).value = simM.a;
                document.getElementById(`wizAway-${m.id}`).value = simM.h;
            }
        }
    });

    updateWizardTable(); // Uppdaterar tabellen och färgkoderna
}

// RÄKNAR UT LIVE-TABELLEN NÄR SIFFROR ÄNDRAS
function updateWizardTable() {
    const letter = groupLetters[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    let tData = {};
    currentTeams.forEach(t => tData[t] = { name: t, pld: 0, pts: 0, gd: 0 });

    groupMatches.forEach(m => {
        const hInputEl = document.getElementById(`wizHome-${m.id}`);
        const aInputEl = document.getElementById(`wizAway-${m.id}`);
        
        if (!hInputEl || !aInputEl) return;
        
        const hInp = hInputEl.value;
        const aInp = aInputEl.value; // Rättad från aInput
        
        const hText = document.getElementById(`wizNameHome-${m.id}`);
        const aText = document.getElementById(`wizNameAway-${m.id}`);
        
        // Återställ CSS-klasser
        if (hText && aText) {
            hText.className = "team-name home";
            aText.className = "team-name away";
        }

        if (hInp !== '' && aInp !== '') {
            const h = parseInt(hInp); 
            const a = parseInt(aInp);
            
            // Lägg till färgkodning för vinnare (Fetstilt/Grå)
            if (hText && aText) {
                if(h > a) { hText.classList.add('is-winner'); aText.classList.add('is-loser'); }
                else if(a > h) { aText.classList.add('is-winner'); hText.classList.add('is-loser'); }
                else { hText.classList.add('is-draw'); aText.classList.add('is-draw'); }
            }
            
            let ht = tData[m.homeTeam]; 
            let at = tData[m.awayTeam];
            
            ht.pld++; at.pld++; 
            ht.gd += (h-a); at.gd += (a-h);
            
            if (h > a) ht.pts += 3; 
            else if (h < a) at.pts += 3; 
            else { ht.pts++; at.pts++; }
        }
    });

    let sorted = Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd);
    let html = `<table class="group-table" style="background:transparent;"><thead><tr><th>Lag</th><th>S</th><th>+/-</th><th>P</th></tr></thead><tbody>`;
    
    sorted.forEach((t, i) => {
        let bg = i===0 ? 'background-color: rgba(40, 167, 69, 0.1);' : (i===1 ? 'background-color: rgba(23, 162, 184, 0.05);' : '');
        html += `<tr style="${bg}"><td style="padding-left: 5px;">${f(t.name)}${t.name}</td><td>${t.pld}</td><td>${t.gd > 0 ? '+'+t.gd : t.gd}</td><td><strong>${t.pts}</strong></td></tr>`;
    });
    
    const liveTable = document.getElementById('wizard-live-table');
    if(liveTable) liveTable.innerHTML = html + `</tbody></table>`;
}

// SPARA TILL FIREBASE
async function saveAndNext() {
    const letter = groupLetters[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    
    const batch = writeBatch(db);
    const userId = auth.currentUser.uid;

    groupMatches.forEach(m => {
        const h = document.getElementById(`wizHome-${m.id}`).value;
        const a = document.getElementById(`wizAway-${m.id}`).value;
        
        if(h !== '' && a !== '') {
            const tipRef = doc(db, "users", userId, "tips", m.id.toString());
            // Sparar ner lag och resultat för varje match på användarens profil
            batch.set(tipRef, { 
                homeScore: parseInt(h), 
                awayScore: parseInt(a), 
                homeTeam: m.homeTeam, 
                awayTeam: m.awayTeam, 
                stage: m.stage 
            });
        }
    });

    try {
        await batch.commit();
        
        if (currentIndex < 11) { 
            loadGroup(++currentIndex); 
            window.scrollTo(0,0); 
        } else { 
            alert("Snyggt jobbat! Gruppspelet är färdigtippat. Slutspelsträdet låses upp!"); 
            // Fejka ett klick på bracket-fliken
            const bracketTabBtn = document.querySelector('.tab-btn[data-target="bracket-tab"]');
            if(bracketTabBtn) bracketTabBtn.click();
        }
    } catch (e) { 
        console.error("Fel vid sparning", e); 
        alert("Kunde inte spara. Har du uppdaterat reglerna i Firestore?");
    }
}
