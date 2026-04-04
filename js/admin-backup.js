import { db } from './config.js';
import { collection, getDocs, doc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion } from './admin.js';

const SPECIAL_IDS = ['_settings', '_results', '_bracket', '_tournament'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function setStatus(msg, isError) {
    const el = document.getElementById('admin-backup-status');
    if (el) {
        el.textContent = msg;
        el.style.color = isError ? '#dc3545' : '#888';
        if (msg) setTimeout(() => { el.textContent = ''; }, 6000);
    }
}

async function exportBackup() {
    setStatus('Exporterar...');
    try {
        const snap = await getDocs(collection(db, "matches"));
        const matches = {};
        const special = {};

        snap.forEach(d => {
            if (d.id.startsWith('_')) {
                special[d.id] = d.data();
            } else {
                matches[d.id] = d.data();
            }
        });

        const backup = {
            exportedAt: new Date().toISOString(),
            version: 1,
            matches,
            special
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `munkentipset-backup-${date}.json`;
        a.click();
        URL.revokeObjectURL(url);

        const matchCount = Object.keys(matches).length;
        const specialCount = Object.keys(special).length;
        setStatus(`✓ Exporterade ${matchCount} matcher + ${specialCount} systemdokument.`);
    } catch (err) {
        console.error('Export failed:', err);
        setStatus('Exportering misslyckades: ' + err.message, true);
    }
}

async function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        setStatus('Filen är för stor (max 5 MB).', true);
        e.target.value = '';
        return;
    }

    const text = await file.text();
    e.target.value = '';

    let backup;
    try {
        backup = JSON.parse(text);
    } catch {
        setStatus('Ogiltig JSON-fil.', true);
        return;
    }

    if (!backup.version || !backup.matches || typeof backup.matches !== 'object') {
        setStatus('Filen saknar rätt format (version/matches).', true);
        return;
    }

    const matchCount = Object.keys(backup.matches).length;
    const specialCount = backup.special ? Object.keys(backup.special).length : 0;
    const ok = confirm(
        `Detta kommer skriva över matchdata i databasen.\n\n` +
        `Filen innehåller ${matchCount} matcher och ${specialCount} systemdokument.\n` +
        `Exporterad: ${backup.exportedAt || 'okänt'}\n\n` +
        `Vill du fortsätta?`
    );
    if (!ok) return;

    setStatus('Importerar...');
    try {
        // Collect all write operations
        const ops = [];
        for (const [id, data] of Object.entries(backup.matches)) {
            ops.push({ id, data });
        }
        if (backup.special) {
            for (const [id, data] of Object.entries(backup.special)) {
                ops.push({ id, data });
            }
        }

        // Write in batches of 500
        for (let i = 0; i < ops.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = ops.slice(i, i + 500);
            for (const { id, data } of chunk) {
                batch.set(doc(db, "matches", id), data);
            }
            await batch.commit();
        }

        await bumpDataVersion();
        setStatus(`✓ Importerade ${matchCount} matcher + ${specialCount} systemdokument.`);
    } catch (err) {
        console.error('Import failed:', err);
        setStatus('Importering misslyckades: ' + err.message, true);
    }
}

export function initBackup() {
    document.getElementById('admin-export-backup').addEventListener('click', exportBackup);
    document.getElementById('admin-import-backup').addEventListener('change', importBackup);
}
