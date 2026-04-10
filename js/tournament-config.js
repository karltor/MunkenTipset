/**
 * Tournament Configuration Module
 *
 * Central config loader for tournament structure. All JS files import helpers
 * from here instead of hardcoding GROUP_LETTERS, ROUNDS, etc.
 *
 * The config is stored in Firestore at matches/_tournament. If no doc exists,
 * the WC2026 default is used for backwards compatibility.
 *
 * Tournament format is modeled as a pipeline of "stages", each with a type:
 *   - "round-robin-groups": group stage (e.g. VM, EM)
 *   - "single-elimination": knockout bracket (optionally two-legged)
 *   - "league": full league season (e.g. Allsvenskan)
 * New stage types (double-elimination, Swiss, etc.) can be added later.
 */

import { db } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ── WC2026 fallback (matches current hardcoded behavior) ────────────
const WC2026_DEFAULT = {
    name: "MunkenTipset 2026",
    championLabel: "Ditt VM-Guld 2026",
    year: 2026,
    stages: [
        {
            id: "groups",
            type: "round-robin-groups",
            label: "Gruppspel",
            groups: {
                letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
                teamsPerGroup: 4,
            },
            qualification: {
                perGroup: 2,
                bestOfRest: 8,
            },
            scoring: {
                matchResult: 1,
                matchHomeGoals: 1,
                matchAwayGoals: 1,
                exactScore: 0,
                groupWinner: 1,
                groupRunnerUp: 1,
                groupThird: 0,
            },
        },
        {
            id: "knockout",
            type: "single-elimination",
            label: "Slutspel",
            twoLegged: false,
            rounds: [
                { key: "r32", label: "Sextondelsfinal", adminKey: "R32", teams: 32, points: 2 },
                { key: "r16", label: "Åttondelsfinal",  adminKey: "R16", teams: 16, points: 2 },
                { key: "qf",  label: "Kvartsfinal",      adminKey: "KF",  teams: 8,  points: 2 },
                { key: "sf",  label: "Semifinal",         adminKey: "SF",  teams: 4,  points: 5 },
                { key: "final", label: "Final",           adminKey: "Final", teams: 2, points: 10 },
            ],
        },
    ],
};

let _config = null;
const CONFIG_CACHE_KEY = 'munkentipset_tournament_config_v1';

function _loadConfigCache() {
    try {
        const raw = localStorage.getItem(CONFIG_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function _saveConfigCache(dataVersion, config) {
    try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ dataVersion, config }));
    } catch { /* quota exceeded */ }
}

// Pre-load cached config synchronously so getConfig() works before async load
const _preloaded = _loadConfigCache();
if (_preloaded?.config) _config = _preloaded.config;

// ── Load config from Firestore (with localStorage cache) ───────────
// Pass dataVersion from settings to avoid extra Firestore read
export async function loadTournamentConfig(dataVersion) {
    try {
        if (dataVersion !== undefined) {
            const cached = _loadConfigCache();
            if (cached && cached.dataVersion === dataVersion && cached.config) {
                _config = cached.config;
                return _config;
            }
        }

        const snap = await getDoc(doc(db, "matches", "_tournament"));
        if (snap.exists()) {
            _config = snap.data();
        } else {
            _config = WC2026_DEFAULT;
        }
        if (dataVersion !== undefined) _saveConfigCache(dataVersion, _config);
    } catch {
        const cached = _loadConfigCache();
        _config = cached?.config || WC2026_DEFAULT;
    }
    return _config;
}

// ── Raw config access ───────────────────────────────────────────────
export function getConfig() {
    return _config || WC2026_DEFAULT;
}

// ── Stage helpers ───────────────────────────────────────────────────
export function getStage(id) {
    return getConfig().stages.find(s => s.id === id) || null;
}

export function getStageByType(type) {
    return getConfig().stages.find(s => s.type === type) || null;
}

export function hasStageType(type) {
    return getConfig().stages.some(s => s.type === type);
}

// ── Convenience: groups ─────────────────────────────────────────────
export function getGroupLetters() {
    const stage = getStageByType('round-robin-groups');
    return stage?.groups?.letters || [];
}

export function getGroupStageConfig() {
    return getStageByType('round-robin-groups');
}

// ── Convenience: knockout ───────────────────────────────────────────
export function getKnockoutRounds() {
    const stage = getStageByType('single-elimination');
    return stage?.rounds || [];
}

export function getKnockoutStageConfig() {
    return getStageByType('single-elimination');
}

/** Map from user-facing round key to admin/bracket key, e.g. "qf" → "KF" */
export function getRoundAdminKey(roundKey) {
    const round = getKnockoutRounds().find(r => r.key === roundKey);
    return round?.adminKey || roundKey.toUpperCase();
}

/** Map from admin/bracket key to user-facing round key, e.g. "KF" → "qf" */
export function getRoundUserKey(adminKey) {
    const round = getKnockoutRounds().find(r => r.adminKey === adminKey);
    return round?.key || adminKey.toLowerCase();
}

/** Get the last knockout round (the final) */
export function getFinalRound() {
    const rounds = getKnockoutRounds();
    return rounds.length > 0 ? rounds[rounds.length - 1] : null;
}

/** Whether knockout is two-legged (can be overridden per round) */
export function isTwoLegged(roundKey) {
    const stage = getKnockoutStageConfig();
    if (!stage) return false;
    const round = stage.rounds.find(r => r.key === roundKey);
    if (round && round.twoLegged !== undefined) return round.twoLegged;
    return stage.twoLegged || false;
}

// ── Convenience: special questions ─────────────────────────────────
export function getSpecialQuestionsConfig() {
    return getStageByType('special-questions');
}

export function hasSpecialQuestions() {
    return hasStageType('special-questions');
}

// ── Convenience: league ─────────────────────────────────────────────
export function getLeagueStageConfig() {
    return getStageByType('league');
}

// ── Convenience: tournament meta ────────────────────────────────────
export function getTournamentName() {
    return getConfig().name || 'MunkenTipset';
}

export function getTournamentYear() {
    return getConfig().year || new Date().getFullYear();
}

export function getChampionLabel() {
    return getConfig().championLabel || 'Mästare';
}
