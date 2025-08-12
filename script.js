// script.js (v46.0 - DEFINITIVE: On-the-Fly Career Curve Calculation, All Logic Complete)

// --- GLOBAL STATE & CONFIGURATION ---
let fullData = { modelNames: [] };
let loadedSeasonDataCache = {};
let playerHistoryCache = null;
let isFetchingPlayerHistory = false;
let currentSort = { column: "custom_z_score_display", direction: "desc" };
let accuracyChartInstance = null;
let careerChartInstance = null;
let modalChartInstance = null;
let dailyProjectionState = { mode: 'single', selectedModel: 'Ensemble', blendWeights: {} };
let careerChartState = { highlightedPlayers: new Map() };

const STAT_CONFIG = { PTS: { name: "PTS", zKey: "z_PTS" }, REB: { name: "REB", zKey: "z_REB" }, AST: { name: "AST", zKey: "z_AST" }, STL: { name: "STL", zKey: "z_STL" }, BLK: { name: "BLK", zKey: "z_BLK" }, '3PM': { name: "3PM", zKey: "z_3PM" }, TOV: { name: "TOV", zKey: "z_TOV" }, FG_impact: { name: "FG%", zKey: "z_FG_impact" }, FT_impact: { name: "FT%", zKey: "z_FT_impact" } };
const ALL_STAT_KEYS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TOV", "FG_impact", "FT_impact"];
const BLENDABLE_STATS = ['points', 'reb', 'ast'];
const MODAL_CHART_STATS = { PTS: "Points", REB: "Rebounds", AST: "Assists", STL: "Steals", BLK: "Blocks", '3PM': "3-Pointers" };
const MODEL_COLORS = {'Ensemble': '#0d6efd', 'Base Transformer': '#ffc107', 'Bestest Transformer': '#198754', 'Lowest MAE': '#6f42c1', 'Smart Blend': '#dc3545', 'Default': '#fd7e14' };
const TEAM_COLORS = { ATL: '#E03A3E', CHI: '#418FDE', CON: '#002663', DAL: '#002855', IND: '#FFC633', LVA: '#000000', LAS: '#702F8A', MIN: '#005083', NYL: '#00A189', PHO: '#201747', SEA: '#2C5234', WAS: '#C8102E', GSV: '#FDB927', FA: 'rgba(128, 128, 128, 0.2)' };
const TEAM_ABBR_MAP = {'Atlanta Dream': 'ATL', 'Chicago Sky': 'CHI', 'Connecticut Sun': 'CON', 'Dallas Wings': 'DAL', 'Indiana Fever': 'IND', 'Las Vegas Aces': 'LVA', 'Los Angeles Sparks': 'LAS', 'Minnesota Lynx': 'MIN', 'New York Liberty': 'NYL', 'Phoenix Mercury': 'PHO', 'Seattle Storm': 'SEA', 'Washington Mystics': 'WAS', 'Golden State Valkyries': 'GSV' };
const REVERSE_TEAM_MAP = { 'ATL': 'Atlanta Dream', 'CHI': 'Chicago Sky', 'CON': 'Connecticut Sun', 'DAL': 'Dallas Wings', 'IND': 'Indiana Fever', 'LVA': 'Las Vegas Aces', 'LAS': 'Los Angeles Sparks', 'MIN': 'Minnesota Lynx', 'NYL': 'New York Liberty', 'PHO': 'Phoenix Mercury', 'SEA': 'Seattle Storm', 'WAS': 'Washington Mystics', 'GSV': 'Golden State Valkyries' };


// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
    initializeTheme();
    try {
        const response = await fetch("predictions.json");
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const rawData = await response.json();
        
        fullData.modelNames = Object.keys(MODEL_COLORS).filter(k => k !== 'Default');
        dailyProjectionState.selectedModel = fullData.modelNames.includes('Ensemble') ? 'Ensemble' : fullData.modelNames[0];

        fullData = { ...fullData, ...rawData };
        document.getElementById("last-updated").textContent = new Date(fullData.lastUpdated).toLocaleString();
        
        initializeSeasonTab();
        initializeDailyTab();
        document.querySelector('.tab-link[onclick*="TeamAnalysis"]').addEventListener('click', renderTeamAnalysis);
        document.querySelector('.tab-link[onclick*="PlayerProgression"]').addEventListener('click', renderPlayerProgression);
        document.querySelector('.tab-link[onclick*="CareerAnalysis"]').addEventListener('click', () => { /* Career Analysis now renders on demand */ });

        document.body.addEventListener('click', handleGlobalClicks);
        document.querySelector('.tab-link').click();

    } catch (e) {
        console.error("FATAL: Failed to initialize application.", e);
        document.body.innerHTML = `<div style="text-align:center; padding: 50px; font-size:1.2em;">Error: Could not load core application data (predictions.json). Please check the file path and browser console for details.<br><br><i>${e.message}</i></div>`;
    }
});

function initializeTheme() {
    const themeSwitcher = document.querySelector('.theme-switcher');
    const doc = document.documentElement;
    const storedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    doc.setAttribute('data-theme', storedTheme);
    themeSwitcher?.addEventListener('click', () => {
        const newTheme = doc.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        doc.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
}

function openTab(evt, tabName) {
    document.querySelectorAll(".tab-content").forEach(tab => tab.style.display = "none");
    document.querySelectorAll(".tab-link").forEach(link => link.classList.remove("active"));
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add("active");
    if(tabName === 'CareerAnalysis') renderCareerAnalysisTab();
}

async function fetchSeasonData(key) {
    if (!key) return null;
    if (loadedSeasonDataCache[key]) return loadedSeasonDataCache[key];
    try {
        const response = await fetch(`data/${key}.json`);
        if (!response.ok) throw new Error(`File not found for key: ${key}`);
        const data = await response.json();
        loadedSeasonDataCache[key] = data;
        return data;
    } catch (e) { console.error(`Error fetching data/${key}.json`, e); return null; }
}

function handleGlobalClicks(e) {
    const playerLink = e.target.closest('.player-link');
    if (playerLink) {
        e.preventDefault();
        const personId = parseInt(playerLink.dataset.personId, 10);
        if (fullData.playerProfiles && fullData.playerProfiles[personId]) {
            showPlayerProfileOverlay(fullData.playerProfiles[personId]);
        } else { console.warn(`No profile found for personId: ${personId}.`); }
        return;
    }
    const expandButton = e.target.closest('.expand-details-btn');
    if (expandButton) {
        const card = expandButton.closest('.matchup-card');
        card.classList.toggle('expanded');
        expandButton.textContent = card.classList.contains('expanded') ? 'Hide Details' : 'Show Details';
    }
}

// --- PLAYER PROFILE OVERLAY ---
async function fetchPlayerHistory() {
    if (playerHistoryCache) return;
    if (isFetchingPlayerHistory) {
        await new Promise(resolve => {
            const interval = setInterval(() => { if (!isFetchingPlayerHistory) { clearInterval(interval); resolve(); } }, 100);
        });
        return;
    }
    isFetchingPlayerHistory = true;
    try {
        const response = await fetch('player_performance_history.json');
        if (!response.ok) throw new Error(`HTTP error for performance history: ${response.status}`);
        playerHistoryCache = await response.json();
    } catch (e) {
        console.error("Failed to load player history file:", e);
        const chartContainer = document.getElementById('modal-chart-container');
        if (chartContainer) chartContainer.innerHTML = `<div class="statline-placeholder"><p>Error: Could not load player chart data.</p></div>`;
    } finally {
        isFetchingPlayerHistory = false;
    }
}

async function showPlayerProfileOverlay(profile) {
    const overlay = document.getElementById("player-profile-overlay");
    overlay.innerHTML = buildPlayerProfileModalHTML(profile);

    await fetchPlayerHistory();
    
    const fullProfileData = {
        ...profile,
        ...(playerHistoryCache ? playerHistoryCache[profile.personId] : {})
    };

    const renderContent = async () => {
        const chartContainer = document.getElementById('modal-chart-container');
        const careerCurveToggle = overlay.querySelector('#career-curve-toggle-checkbox').checked;
        if (careerCurveToggle) {
            await renderPlayerCareerCurveChart(fullProfileData, chartContainer);
        } else {
            await renderPlayerPerformanceHistoryChart(fullProfileData, chartContainer);
        }
    };
    
    overlay.querySelector('.modal-controls').addEventListener('change', renderContent);
    overlay.querySelector('.reset-zoom-btn')?.addEventListener('click', () => modalChartInstance?.resetZoom());
    
    const closeModal = () => {
        overlay.classList.remove("visible");
        if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
        overlay.innerHTML = '';
    };
    overlay.querySelector(".modal-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });

    overlay.classList.add("visible");
    await renderContent();
}

function buildPlayerProfileModalHTML(profile) {
    const statSelectorOptions = Object.entries(MODAL_CHART_STATS).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
    const modelToggles = fullData.modelNames.map(name => `
        <div class="chart-toggle">
            <span class="chart-toggle-label">${name}</span>
            <label class="chart-toggle-switch"><input type="checkbox" class="modal-model-toggle" data-model="${name}" checked><span class="chart-toggle-slider"></span></label>
        </div>`).join('');
    
    return `
    <div class="grade-modal player-modal">
        <div class="modal-header">
            <h2>${profile.playerName || 'Unknown Player'}</h2>
            <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="player-profile-grid">
            <div class="profile-sidebar"><div class="profile-info-grid">
                <div class="profile-info-item"><div class="profile-info-label">Position</div><div class="profile-info-value">${profile.position || 'N/A'}</div></div>
                <div class="profile-info-item"><div class="profile-info-label">Team</div><div class="profile-info-value">${profile.team || 'N/A'}</div></div>
                <div class="profile-info-item"><div class="profile-info-label">Draft</div><div class="profile-info-value">${profile.draftInfo || 'N/A'}</div></div>
            </div></div>
            <div class="profile-main modal-controls">
                <div class="profile-main-header">
                    <h3>Performance Chart</h3>
                    <div class="chart-toggle">
                        <span class="chart-toggle-label">Career Curve</span>
                        <label class="chart-toggle-switch"><input type="checkbox" id="career-curve-toggle-checkbox"><span class="chart-toggle-slider"></span></label>
                    </div>
                </div>
                <div class="controls-card">
                    <div class="modal-chart-controls">
                        <div class="filter-group"><label for="modal-stat-selector">STATISTIC</label><select id="modal-stat-selector">${statSelectorOptions}</select></div>
                        <button class="button-outline reset-zoom-btn">Reset Zoom</button>
                    </div>
                    <div class="modal-model-toggles"><div class="toggles-grid">${modelToggles}</div></div>
                </div>
                <div class="chart-wrapper" id="modal-chart-container"><canvas id="modal-chart"></canvas></div>
            </div>
        </div>
    </div>`;
}

async function renderPlayerPerformanceHistoryChart(profile, container) {
    const statKey = document.getElementById('modal-stat-selector')?.value || 'PTS';
    if (modalChartInstance) modalChartInstance.destroy();
    const canvas = container.querySelector('canvas');
    if (!canvas) { container.innerHTML = '<canvas id="modal-chart"></canvas>'; }
    const ctx = container.querySelector('canvas').getContext('2d');

    document.querySelector('.modal-model-toggles').style.display = 'block';
    document.querySelector('.reset-zoom-btn').style.display = 'block';
    document.querySelector('.profile-main-header h3').textContent = `Performance & Projections: ${MODAL_CHART_STATS[statKey]}`;

    const datasets = [];
    const history = profile.performanceHistory || [];
    if (history.length > 0) {
        const actualData = history.map(d => ({ x: d.game_number, y: d[statKey] })).filter(d => d.y != null);
        if (actualData.length > 0) datasets.push({ label: 'Actual', data: actualData, borderColor: 'var(--text-primary)', backgroundColor: 'var(--text-primary)', type: 'line', tension: 0.1, borderWidth: 3, pointRadius: 0, order: 10 });
    }

    const projections = profile.futureProjections || [];
    if (projections.length > 0) {
        fullData.modelNames.forEach(modelName => {
            const modelData = projections.filter(p => p.model_source === modelName && p[statKey] != null).map(p => ({ x: p.game_number, y: p[statKey] }));
            if (modelData.length > 0) datasets.push({ label: modelName, data: modelData, borderColor: MODEL_COLORS[modelName] || MODEL_COLORS['Default'], backgroundColor: MODEL_COLORS[modelName] || MODEL_COLORS['Default'], borderWidth: 2, pointRadius: 0, borderDash: [5, 5], hidden: !document.querySelector(`.modal-model-toggle[data-model="${modelName}"]`)?.checked });
        });
    }

    if (datasets.length === 0) { container.innerHTML = '<div class="statline-placeholder"><p>No performance or projection data available for this player.</p></div>'; return; }
    modalChartInstance = new Chart(ctx, { type: 'line', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'linear', title: { display: true, text: 'WNBA Games Played' } }, y: { beginAtZero: true, title: { display: true, text: MODAL_CHART_STATS[statKey] } } }, plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false }, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } } }, interaction: { mode: 'nearest', axis: 'x', intersect: false } } });
}

async function renderPlayerCareerCurveChart(profile, container) {
    const statKey = document.getElementById('modal-stat-selector')?.value || 'PTS';
    if (modalChartInstance) modalChartInstance.destroy();
    const canvas = container.querySelector('canvas');
    if (!canvas) { container.innerHTML = '<canvas id="modal-chart"></canvas>'; }
    const ctx = container.querySelector('canvas').getContext('2d');

    document.querySelector('.modal-model-toggles').style.display = 'none';
    document.querySelector('.reset-zoom-btn').style.display = 'none';
    document.querySelector('.profile-main-header h3').textContent = `Career Curve (3-Month Rolling Avg): ${MODAL_CHART_STATS[statKey]}`;
    
    const history = profile.performanceHistory;
    if (!history || history.length < 5) { // Need a minimum number of games for a rolling average
        container.innerHTML = '<div class="statline-placeholder"><p>Not enough historical data to calculate a career curve.</p></div>';
        return;
    }

    // ON-THE-FLY CALCULATION
    const dataPoints = history.map(d => ({ time: new Date(d.date).getTime(), value: d[statKey] })).filter(d => d.value != null);
    const rollingAvgData = [];
    const windowMillis = 90 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < dataPoints.length; i++) {
        const currentPoint = dataPoints[i];
        let sum = 0;
        let count = 0;
        for (let j = i; j >= 0; j--) {
            const pastPoint = dataPoints[j];
            if (currentPoint.time - pastPoint.time <= windowMillis) {
                sum += pastPoint.value;
                count++;
            } else {
                break;
            }
        }
        if (count > 0) {
            rollingAvgData.push({ x: currentPoint.time, y: sum / count });
        }
    }

    const datasets = [{ label: `Rolling Avg. ${statKey}`, data: rollingAvgData, borderColor: 'var(--primary-color)', tension: 0.2, pointRadius: 3, pointBackgroundColor: 'var(--primary-color)', pointBorderColor: 'var(--bg-secondary)', pointHoverRadius: 5 }];
    modalChartInstance = new Chart(ctx, { type: 'line', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'time', time: { unit: 'year' }, title: { display: true, text: 'Date' } }, y: { title: { display: true, text: `Rolling Avg. ${MODAL_CHART_STATS[statKey]}` } } } } });
}

function initializeSeasonTab() {
    const manifest = fullData.seasonLongDataManifest || {};
    const selector = document.getElementById("season-source-selector");

    const buildOptions = (filterFn, label) => {
        const keys = Object.keys(manifest)
            .filter(filterFn)
            .sort((a, b) => manifest[b].label.localeCompare(manifest[a].label));
        if (keys.length === 0) return '';
        return `<optgroup label="${label}">${keys.map(key => `<option value="${key}">${manifest[key].label.replace(/\s*\(.*\)\s*/g, '').trim()}</option>`).join('')}</optgroup>`;
    };

    const projections = buildOptions(k => k.includes('projections_2025') && k.includes('per_game'), '2025 Projections');
    const actuals = buildOptions(k => k.includes('actuals') && k.includes('per_game'), 'Past Seasons');
    selector.innerHTML = projections + actuals;

    document.getElementById("calculation-mode").addEventListener('change', (e) => {
        const isTotal = e.target.value === 'total';
        const currentSelection = selector.value;
        if (isTotal && currentSelection.includes('per_game')) {
            selector.value = currentSelection.replace('per_game', 'total');
        } else if (!isTotal && currentSelection.includes('total')) {
            selector.value = currentSelection.replace('total', 'per_game');
        }
        onSeasonControlsChange();
    });

    selector.addEventListener('change', onSeasonControlsChange);
    document.getElementById("category-weights-grid").innerHTML = ALL_STAT_KEYS.map(key => `<div class="category-item"><label><input type="checkbox" data-key="${key}" checked> ${STAT_CONFIG[key].name}</label></div>`).join('');
    document.getElementById("season-controls").addEventListener("change", onSeasonControlsChange);
    document.getElementById("search-player").addEventListener("input", onSeasonControlsChange);
    document.getElementById("predictions-thead").addEventListener("click", handleSortSeason);
    onSeasonControlsChange();
}

function onSeasonControlsChange() {
    renderSeasonTable();
    if(document.getElementById('TeamAnalysis').style.display === 'block') renderTeamAnalysis();
    if(document.getElementById('PlayerProgression').style.display === 'block') renderPlayerProgression();
}

async function renderSeasonTable() {
    const selector = document.getElementById("season-source-selector");
    let baseKey = selector.value;
    const calcMode = document.getElementById("calculation-mode").value;
    
    if (baseKey.includes('per_game') && calcMode === 'total') {
        baseKey = baseKey.replace('per_game', 'total');
    } else if (baseKey.includes('total') && calcMode === 'per_game') {
        baseKey = baseKey.replace('total', 'per_game');
    }
    const sourceKey = baseKey;
    
    const settings = { showCount: parseInt(document.getElementById("show-count").value, 10), searchTerm: document.getElementById("search-player").value.toLowerCase().trim(), activeCategories: new Set(Array.from(document.querySelectorAll("#category-weights-grid input:checked")).map(cb => cb.dataset.key)) };
    const tbody = document.getElementById("predictions-tbody");
    tbody.innerHTML = `<tr><td colspan="17" style="text-align:center;">Loading team data...</td></tr>`;
    let data = await fetchSeasonData(sourceKey);
    if (!data) { tbody.innerHTML = `<tr><td colspan="17" class="error-cell">Could not load data for ${sourceKey}.</td></tr>`; return; }

    let processedData = data.map(player => ({ ...player, custom_z_score_display: Array.from(settings.activeCategories).reduce((acc, catKey) => acc + (player[STAT_CONFIG[catKey].zKey] || 0), 0) }));
    if (settings.searchTerm) processedData = processedData.filter(p => p.playerName?.toLowerCase().includes(settings.searchTerm));
    
    currentSort.data = processedData;
    if (!processedData.some(p => p[currentSort.column])) { currentSort.column = 'custom_z_score_display'; currentSort.direction = 'desc'; }
    sortSeasonData();
    renderSeasonTableBody(settings.showCount);
}

function handleSortSeason(e) {
    const th = e.target.closest("th");
    if (!th?.dataset.sortKey) return;
    const sortKey = th.dataset.sortKey;
    if (currentSort.column === sortKey) { currentSort.direction = currentSort.direction === "desc" ? "asc" : "desc"; }
    else { currentSort.column = sortKey; currentSort.direction = ["playerName", "position", "team"].includes(sortKey) ? "asc" : "desc"; }
    sortSeasonData();
    renderSeasonTableBody(parseInt(document.getElementById("show-count").value, 10));
}

function sortSeasonData() {
    const { column, direction, data } = currentSort;
    if (!data) return;
    const mod = direction === "asc" ? 1 : -1;
    data.sort((a, b) => {
        let valA = a[column] ?? (typeof a[column] === 'string' ? '' : -Infinity);
        let valB = b[column] ?? (typeof b[column] === 'string' ? '' : -Infinity);
        if (typeof valA === 'string') return valA.localeCompare(valB) * mod;
        return (valA - valB) * mod;
    });
}

function renderSeasonTableBody(showCount) {
    const isTotalMode = document.getElementById("calculation-mode").value === 'total';
    const minutesHeader = isTotalMode ? 'Total MIN' : 'MPG';
    const thead = document.getElementById("predictions-thead");
    thead.innerHTML = `<tr><th>R#</th><th data-sort-key="playerName">Player</th><th data-sort-key="position">Pos</th><th data-sort-key="team">Team</th><th data-sort-key="GP">GP</th><th data-sort-key="MIN">${minutesHeader}</th>${ALL_STAT_KEYS.map(k=>`<th data-sort-key="${STAT_CONFIG[k].zKey}">${STAT_CONFIG[k].name}</th>`).join('')}<th data-sort-key="custom_z_score_display">TOTAL▼</th></tr>`;
    document.querySelectorAll('#predictions-thead th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
    const currentTh = thead.querySelector(`[data-sort-key="${currentSort.column}"]`);
    if (currentTh) currentTh.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    const tbody = document.getElementById("predictions-tbody");
    const dataToRender = currentSort.data?.slice(0, showCount) || [];
    if (!dataToRender.length) { tbody.innerHTML = `<tr><td colspan="17" class="error-cell">No players match criteria.</td></tr>`; return; }
    const getZClass = z => z >= 1.5 ? 'elite' : z >= 1.0 ? 'very-good' : z >= 0.5 ? 'good' : z <= -1.0 ? 'not-good' : z <= -0.5 ? 'below-average' : 'average';
    tbody.innerHTML = dataToRender.map((p, i) => `<tr><td>${i + 1}</td><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName || 'N/A'}</a></td><td>${p.position || 'N/A'}</td><td>${p.team || 'N/A'}</td><td>${(p.GP || 0).toFixed(0)}</td><td>${(p.MIN || 0).toFixed(1)}</td>${ALL_STAT_KEYS.map(key => { const zKey = STAT_CONFIG[key].zKey; const zValue = p[zKey] || 0; let displayValue; const rawKey = key.replace('_impact', ''); const value = p[rawKey] || 0; if (key.includes('_impact')) { const made = key === 'FG_impact' ? p.FGM : p.FTM; const att = key === 'FG_impact' ? p.FGA : p.FTA; displayValue = (att !== undefined && att > 0) ? (made / att).toFixed(3) : (p[key.replace('_impact', '_pct')] || 0).toFixed(3); } else { displayValue = value.toFixed(isTotalMode ? 0 : 1); } return `<td class="stat-cell ${getZClass(zValue)}"><span class="stat-value">${displayValue}</span><span class="z-score-value">${(zValue || 0).toFixed(2)}</span></td>`; }).join('')}<td>${(p.custom_z_score_display || 0).toFixed(2)}</td></tr>`).join('');
}

function initializeDailyTab() {
    const modelSelector = document.getElementById("daily-model-selector");
    const blendWeightsGrid = document.getElementById("daily-blend-weights-grid");
    modelSelector.innerHTML = fullData.modelNames.map(name => `<option value="${name}">${name}</option>`).join('');
    modelSelector.value = dailyProjectionState.selectedModel;
    blendWeightsGrid.innerHTML = fullData.modelNames.map(name => { dailyProjectionState.blendWeights[name] = 0; return `<div class="category-item"><label><span>${name}</span><input type="number" class="blend-weight-input" data-model="${name}" value="0" min="0" step="1"> %</label></div>`; }).join('');
    document.getElementById('mode-single-btn').addEventListener('click', () => setDailyProjectionMode('single'));
    document.getElementById('mode-blend-btn').addEventListener('click', () => setDailyProjectionMode('blend'));
    document.getElementById('daily-model-selector').addEventListener('change', (e) => { dailyProjectionState.selectedModel = e.target.value; updateDailyGamesView(); });
    document.querySelectorAll('.blend-weight-input').forEach(input => { input.addEventListener('change', (e) => { dailyProjectionState.blendWeights[e.target.dataset.model] = parseFloat(e.target.value) || 0; updateDailyGamesView(); }); });
    document.getElementById('normalize-weights-btn').addEventListener('click', () => { const totalWeight = Object.values(dailyProjectionState.blendWeights).reduce((a, b) => a + b, 0); if (totalWeight > 0) { document.querySelectorAll('.blend-weight-input').forEach(input => { const model = input.dataset.model; const newWeight = Math.round((dailyProjectionState.blendWeights[model] / totalWeight) * 100); dailyProjectionState.blendWeights[model] = newWeight; input.value = newWeight; }); updateDailyGamesView(); } });
    document.getElementById("accuracy-metric-selector").addEventListener('change', renderAccuracyChart);
    const dateTabs = document.getElementById("daily-date-tabs");
    const sortedDates = fullData.dailyGamesByDate ? Object.keys(fullData.dailyGamesByDate).sort((a, b) => new Date(a) - new Date(b)) : [];
    if (!sortedDates.length) { document.getElementById("daily-games-container").innerHTML = '<div class="card"><p>No daily predictions available.</p></div>'; return; }
    dateTabs.innerHTML = sortedDates.map((date) => `<button class="date-tab" data-date="${date}">${new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</button>`).join('');
    dateTabs.addEventListener("click", e => { const tab = e.target.closest(".date-tab"); if (tab && !tab.classList.contains('active')) { document.querySelectorAll(".date-tab").forEach(t => t.classList.remove("active")); tab.classList.add("active"); renderDailyGamesForDate(tab.dataset.date); } });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let activeTab = Array.from(dateTabs.children).find(tab => new Date(tab.dataset.date + "T00:00:00") >= today) || dateTabs.children[dateTabs.children.length - 1];
    if (activeTab) { activeTab.classList.add("active"); renderDailyGamesForDate(activeTab.dataset.date); }
    renderAccuracyChart();
}

function setDailyProjectionMode(mode) {
    dailyProjectionState.mode = mode;
    document.getElementById('mode-single-btn').classList.toggle('active', mode === 'single');
    document.getElementById('mode-blend-btn').classList.toggle('active', mode === 'blend');
    document.getElementById('single-model-controls').classList.toggle('hidden', mode !== 'single');
    document.getElementById('blend-model-controls').classList.toggle('hidden', mode !== 'blend');
    updateDailyGamesView();
}

function updateDailyGamesView() {
    const activeDateTab = document.querySelector('.date-tab.active');
    if (activeDateTab) {
        renderDailyGamesForDate(activeDateTab.dataset.date);
    }
    renderAccuracyChart();
}

function getActiveProjection(allModelProjections) {
    if (dailyProjectionState.mode === 'single') return allModelProjections[dailyProjectionState.selectedModel] || Object.values(allModelProjections)[0];
    const totalWeight = Object.values(dailyProjectionState.blendWeights).reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return allModelProjections[dailyProjectionState.selectedModel] || Object.values(allModelProjections)[0];
    const firstModel = Object.values(allModelProjections)[0];
    const blendedProjection = [{ teamName: firstModel[0].teamName, totalPoints: 0, players: [] }, { teamName: firstModel[1].teamName, totalPoints: 0, players: [] }];
    const allPlayersMap = new Map();
    for (const modelName of fullData.modelNames) {
        const weight = dailyProjectionState.blendWeights[modelName] || 0;
        if (weight === 0 || !allModelProjections[modelName]) continue;
        const modelProjection = allModelProjections[modelName];
        [0, 1].forEach(teamIndex => { for (const player of modelProjection[teamIndex].players) { if (!allPlayersMap.has(player.personId)) allPlayersMap.set(player.personId, { data: player, teamIndex: teamIndex, weightedStats: {}, totalWeight: 0 }); const playerEntry = allPlayersMap.get(player.personId); for (const stat of BLENDABLE_STATS) { if (typeof player[stat] === 'number') playerEntry.weightedStats[stat] = (playerEntry.weightedStats[stat] || 0) + (player[stat] * weight); } playerEntry.totalWeight += weight; } });
    }
    for (const [_, playerEntry] of allPlayersMap.entries()) { const finalPlayer = { ...playerEntry.data }; for (const stat of BLENDABLE_STATS) { if (playerEntry.totalWeight > 0) finalPlayer[stat] = (playerEntry.weightedStats[stat] || 0) / playerEntry.totalWeight; } blendedProjection[playerEntry.teamIndex].players.push(finalPlayer); }
    [0, 1].forEach(teamIndex => { blendedProjection[teamIndex].totalPoints = blendedProjection[teamIndex].players.reduce((sum, p) => sum + (p.points || 0), 0); blendedProjection[teamIndex].players.sort((a, b) => (b.Predicted_Minutes || 0) - (a.Predicted_Minutes || 0)); });
    return blendedProjection;
}

function renderDailyGamesForDate(date) {
    const container = document.getElementById("daily-games-container");
    const games = fullData.dailyGamesByDate?.[date] || [];
    if (games.length === 0) { container.innerHTML = '<div class="card"><p>No games for this date.</p></div>'; return; }
    const getBadgeClass = pts => pts > 20 ? 'elite' : pts > 15 ? 'very-good' : pts > 10 ? 'good' : 'average';
    container.innerHTML = games.map(game => {
        const activeProjection = getActiveProjection(game.projections);
        if (!activeProjection || activeProjection.length < 2) return '';
        const [team1, team2] = activeProjection;
        const homeTeamAbbr = TEAM_ABBR_MAP[team1.teamName] || 'FA';
        const cardStyle = `border-left-color: var(--team-${homeTeamAbbr.toLowerCase()});`;
        let scoreHTML = `Predicted: <strong>${Math.round(team1.totalPoints)} - ${Math.round(team2.totalPoints)}</strong>`;
        if (game.grade?.isGraded && game.grade.gameSummary.actual) {
            const actualSummary = game.grade.gameSummary.actual;
            const team1Abbr = TEAM_ABBR_MAP[team1.teamName];
            const team2Abbr = TEAM_ABBR_MAP[team2.teamName];
            const actual1 = actualSummary[team1Abbr] !== undefined ? actualSummary[team1Abbr] : '?';
            const actual2 = actualSummary[team2Abbr] !== undefined ? actualSummary[team2Abbr] : '?';
            const modelKey = dailyProjectionState.mode === 'single' ? dailyProjectionState.selectedModel : 'Ensemble';
            const modelGrade = game.grade.model_grades[modelKey] || Object.values(game.grade.model_grades)[0];
            if(actual1 !== '?' && modelGrade) {
                const correctWinnerClass = modelGrade.correctWinner ? 'prediction-correct' : 'prediction-incorrect';
                scoreHTML = `Predicted: <strong class="${correctWinnerClass}">${Math.round(team1.totalPoints)} - ${Math.round(team2.totalPoints)}</strong><span class="actual-score">Actual: <strong>${actual1} - ${actual2}</strong></span>`;
            }
        }
        const createCompactSummary = (teamData) => (teamData.players || []).slice(0, 5).map(p => `<div class="compact-player-badge ${getBadgeClass(p.points)}" title="${p.Player_Name} (Proj. ${p.points.toFixed(1)} pts)">${p.Player_Name.split(' ').pop()}</div>`).join('');
        return `<div class="matchup-card" style="${cardStyle}"><div class="matchup-header"><span class="matchup-teams">${team1.teamName} vs ${team2.teamName}</span><div class="matchup-scores">${scoreHTML}</div></div><div class="matchup-compact-summary"><div class="compact-team">${createCompactSummary(team1)}</div><div class="compact-team">${createCompactSummary(team2)}</div></div><div class="matchup-body">${createTeamTableHTML(team1, game.grade)}${createTeamTableHTML(team2, game.grade)}</div><div class="matchup-footer"><button class="button-outline expand-details-btn">Show Details</button></div></div>`;
    }).join('');
}

function createTeamTableHTML(teamData, gameGrade) {
    const isGraded = gameGrade?.isGraded;
    const getPerfIndicator = (pred, actual) => { if (actual == null || pred == null) return ''; const diff = Math.abs(pred - actual); const relativeError = diff / (actual || pred || 1); if (relativeError < 0.20) return 'pi-good'; if (relativeError > 0.60 && diff > 3) return 'pi-bad'; return 'pi-neutral'; };
    const playersHtml = (teamData.players || []).map(p => {
        const nameHtml = `<a href="#" class="player-link" data-person-id="${p.personId}">${p.Player_Name}</a>`;
        let predRow, actualRow = '';
        const actuals = gameGrade?.playerActuals?.[p.personId];
        predRow = `<tr class="player-row-pred"><td ${isGraded && actuals ? 'rowspan="2"' : ''} class="player-name-cell">${nameHtml}</td><td class="stat-type-cell">P</td><td>${(p.Predicted_Minutes || 0).toFixed(1)}</td><td>${(p.points || 0).toFixed(1)}</td><td>${(p.reb || 0).toFixed(1)}</td><td>${(p.ast || 0).toFixed(1)}</td></tr>`;
        if (isGraded) {
            if (actuals) {
                actualRow = `<tr class="player-row-actual"><td class="stat-type-cell">A</td><td>-</td><td>${(actuals.PTS || 0).toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.points, actuals.PTS)}"></span></td><td>${(actuals.REB || 0).toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.reb, actuals.REB)}"></span></td><td>${(actuals.AST || 0).toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.ast, actuals.AST)}"></span></td></tr>`;
            } else {
                 predRow = predRow.replace('rowspan="2"',''); 
                 actualRow = `<tr class="player-row-pred"><td class="player-name-cell">${nameHtml}</td><td colspan="5" style="text-align:center; color: var(--text-secondary);font-style:italic;">DNP</td></tr>`;
                 return actualRow;
            }
        }
        return predRow + actualRow;
    }).join('');
    return `<div class="team-box-score"><h3 class="team-header">${teamData.teamName}</h3><table class="daily-table"><thead><tr><th style="text-align:left;">Player</th><th></th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>${playersHtml}</tbody></table></div>`;
}

function renderAccuracyChart() {
    const container = document.getElementById("accuracy-chart-container");
    if (!container) return;
    const chartCanvas = document.getElementById('accuracy-chart');
    if (!chartCanvas || !fullData.historicalGrades || fullData.historicalGrades.length < 1) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const ctx = chartCanvas.getContext('2d');
    const metric = document.getElementById('accuracy-metric-selector').value;
    const gradesByDate = fullData.historicalGrades.reduce((acc, g) => { (acc[g.date] = acc[g.date] || []).push(g); return acc; }, {});
    const sortedDates = Object.keys(gradesByDate).sort((a, b) => new Date(a) - new Date(b));
    const datasets = [];
    fullData.modelNames.forEach((modelName, i) => {
        const data = sortedDates.map(date => {
            const dayGrades = gradesByDate[date].map(g => g.model_grades[modelName]).filter(Boolean);
            if (dayGrades.length === 0) return null;
            if (metric === 'cumulativeWinLoss') return null;
            if (metric === 'dailyWinLoss') { const wins = dayGrades.reduce((s, g) => s + (g.correctWinner ? 1 : 0), 0); return dayGrades.length > 0 ? (wins / dayGrades.length) * 100 : 0; }
            const values = dayGrades.map(g => g[metric]).filter(v => v !== undefined && v !== null && !isNaN(v));
            return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
        });
        if (metric === 'cumulativeWinLoss') {
            let wins = 0, total = 0;
            const cumulativeData = sortedDates.map(date => { const dayGrades = gradesByDate[date].map(g => g.model_grades[modelName]).filter(Boolean); wins += dayGrades.reduce((s, g) => s + (g.correctWinner ? 1 : 0), 0); total += dayGrades.length; return total > 0 ? (wins / total) * 100 : 0; });
            datasets.push({ label: modelName, data: cumulativeData, borderColor: MODEL_COLORS[modelName] || MODEL_COLORS['Default'], tension: 0.1, fill: false });
        } else {
            datasets.push({ label: modelName, data, backgroundColor: MODEL_COLORS[modelName] || MODEL_COLORS['Default'] });
        }
    });
    let chartConfig;
    const labels = sortedDates.map(d => new Date(d + "T00:00:00").toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    if (metric === 'cumulativeWinLoss') chartConfig = { type: 'line', data: { labels, datasets }, options: { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } } };
    else chartConfig = { type: 'bar', data: { labels, datasets }, options: metric === 'dailyWinLoss' ? { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } } : {} };
    if (accuracyChartInstance) accuracyChartInstance.destroy();
    accuracyChartInstance = new Chart(ctx, { ...chartConfig, options: { ...chartConfig.options, responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
}

async function renderTeamAnalysis() {
    const container = document.getElementById("team-analysis-container");
    container.innerHTML = '<div class="card"><p>Loading team data...</p></div>';
    let sourceKey = document.getElementById("season-source-selector").value.replace('total', 'per_game');
    const data = await fetchSeasonData(sourceKey);
    if (!data) { container.innerHTML = '<div class="card"><p class="error-cell">Could not load team data.</p></div>'; return; }
    const teams = data.reduce((acc, p) => { (acc[p.team || 'FA'] = acc[p.team || 'FA'] || []).push(p); return acc; }, {});
    container.innerHTML = Object.entries(teams).sort((a,b) => (b[1].reduce((s,p)=>s+(p.custom_z_score||0),0)) - (a[1].reduce((s,p)=>s+(p.custom_z_score||0),0))).map(([teamName, players]) => {
        const teamStrength = players.reduce((sum, p) => sum + (p.custom_z_score || 0), 0);
        const playerRows = players.sort((a,b) => (b.custom_z_score || 0) - (a.custom_z_score || 0)).map(p => `<tr><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName}</a></td><td>${(p.GP||0).toFixed(0)}</td><td>${(p.MIN||0).toFixed(1)}</td><td>${(p.PTS||0).toFixed(1)}</td><td>${(p.REB||0).toFixed(1)}</td><td>${(p.AST||0).toFixed(1)}</td><td>${(p.custom_z_score||0).toFixed(2)}</td></tr>`).join('');
        return `<div class="team-card"><div class="team-card-header"><h3>${teamName === 'FA' ? 'Free Agents' : REVERSE_TEAM_MAP[teamName] || teamName}</h3><div class="team-strength-score">${teamStrength.toFixed(2)}</div></div><div class="table-container"><table><thead><tr><th>Player</th><th>GP</th><th>MPG</th><th>PTS</th><th>REB</th><th>AST</th><th>Z-Score</th></tr></thead><tbody>${playerRows}</tbody></table></div></div>`;
    }).join('');
}

async function renderPlayerProgression() {
    const container = document.getElementById("player-progression-container");
    container.innerHTML = '<div class="card" style="padding:20px; text-align:center;">Loading...</div>';
    let projSourceKey = document.getElementById("season-source-selector").value;
    if(!projSourceKey.includes('projections')) projSourceKey = Object.keys(fullData.seasonLongDataManifest).find(k => k.includes('Ensemble') && k.includes('per_game')) || projSourceKey;
    projSourceKey = projSourceKey.replace('total', 'per_game');
    const futureData = await fetchSeasonData(projSourceKey);
    const historicalData = await fetchSeasonData('actuals_2024_full_per_game');
    if (!futureData || !historicalData) { container.innerHTML = '<div class="card"><p class="error-cell">Could not load progression data.</p></div>'; return; }
    const merged = futureData.map(p_future => { const p_hist = historicalData.find(p => p.personId === p_future.personId); return p_hist ? { ...p_future, z_Total_2024: p_hist.custom_z_score, z_Total_2025_Proj: p_future.custom_z_score, z_Change: (p_future.custom_z_score || 0) - (p_hist.custom_z_score || 0) } : null; }).filter(Boolean);
    let html = createProgressionTable('Top Risers (2025 Proj. vs 2024)', [...merged].sort((a,b)=>b.z_Change-a.z_Change).slice(0,15), "'24 Z","'25 Proj. Z", "z_Total_2024", "z_Total_2025_Proj");
    html += createProgressionTable('Top Fallers (2025 Proj. vs 2024)', [...merged].sort((a,b)=>a.z_Change-b.z_Change).slice(0,15), "'24 Z","'25 Proj. Z", "z_Total_2024", "z_Total_2025_Proj");
    container.innerHTML = html;
}

function createProgressionTable(title, players, th1, th2, key1, key2) {
    const rows = players.map(p => `<tr><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName}</a></td><td>${p.team}</td><td>${(p[key1]||0).toFixed(2)}</td><td>${(p[key2]||0).toFixed(2)}</td><td class="${p.z_Change>=0?'text-success':'text-danger'}">${p.z_Change>=0?'+':''}${(p.z_Change||0).toFixed(2)}</td></tr>`).join('');
    return `<div class="card"><h3>${title}</h3><div class="table-container"><table><thead><tr><th>Player</th><th>Team</th><th>${th1}</th><th>${th2}</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

async function renderCareerAnalysisTab() {
    const container = document.getElementById('CareerAnalysis');
    if (container.dataset.initialized) return;
    
    await fetchPlayerHistory();
    
    document.getElementById("career-controls").addEventListener('change', renderCareerChart);
    document.getElementById('career-add-player-btn').addEventListener('click', handleAddCareerPlayer);
    document.getElementById('career-clear-players-btn').addEventListener('click', () => { careerChartState.highlightedPlayers.clear(); renderHighlightedPlayerList(); renderCareerChart(); });
    const datalist = document.getElementById('player-datalist');
    datalist.innerHTML = Object.values(fullData.playerProfiles).sort((a,b) => a.playerName.localeCompare(b.playerName)).map(p => `<option value="${p.playerName}"></option>`).join('');
    
    renderCareerChart();
    container.dataset.initialized = true;
}

function handleAddCareerPlayer() {
    const input = document.getElementById('career-search-player');
    const player = Object.values(fullData.playerProfiles).find(p => p.playerName.toLowerCase() === input.value.toLowerCase());
    if (player && !careerChartState.highlightedPlayers.has(player.personId)) {
        const color = MODEL_COLORS[Object.keys(MODEL_COLORS)[careerChartState.highlightedPlayers.size % Object.keys(MODEL_COLORS).length]];
        careerChartState.highlightedPlayers.set(player.personId, { name: player.playerName, color: color });
        renderHighlightedPlayerList();
        renderCareerChart();
        input.value = '';
    }
}

function renderHighlightedPlayerList() {
    const container = document.getElementById('career-highlighted-players');
    container.innerHTML = Array.from(careerChartState.highlightedPlayers.values()).map(p => `<span class="guide-item" style="background-color: ${p.color}; color: var(--text-on-dark-bg);">${p.name}</span>`).join('');
}

async function renderCareerChart() {
    if (careerChartInstance) careerChartInstance.destroy();
    const ctx = document.getElementById('career-chart')?.getContext('2d');
    if (!ctx) return;
    
    const stat = document.getElementById("career-stat-selector").value;
    const xAxis = document.getElementById("career-xaxis-selector").value;
    const draftFilter = document.getElementById("career-draft-filter").value;
    const minutesFilter = document.getElementById("career-minutes-filter").value;
    const colorByTeam = document.getElementById("career-color-by-team-toggle").checked;

    if (!playerHistoryCache) {
        document.getElementById("career-chart-wrapper").innerHTML = `<p class="statline-placeholder">Loading player history...</p>`;
        await fetchPlayerHistory();
    }
    
    const datasets = [];
    let playerIdsToDisplay = Object.keys(playerHistoryCache).map(id => parseInt(id, 10));

    // Filtering logic...
    if (draftFilter !== 'All') playerIdsToDisplay = playerIdsToDisplay.filter(id => fullData.playerProfiles[id]?.draftCategory === draftFilter);
    if (minutesFilter === '15_career') playerIdsToDisplay = playerIdsToDisplay.filter(id => (fullData.playerProfiles[id]?.careerAvgMpg || 0) > 15);
    
    playerIdsToDisplay.forEach(id => {
        if (careerChartState.highlightedPlayers.has(id)) return;
        let playerData = playerHistoryCache[id]?.performanceHistory;
        if (!playerData) return;
        if (minutesFilter === '15_game') playerData = playerData.filter(d => d.MIN >= 15);
        
        const playerProfile = fullData.playerProfiles[id];
        const borderColor = colorByTeam ? (TEAM_COLORS[playerProfile?.team] || TEAM_COLORS.FA) : 'rgba(128, 128, 128, 0.2)';
        
        if (playerData.length > 0) datasets.push({ label: `Player ${id}`, data: playerData.map(d => ({ x: d[xAxis], y: d[stat] })).filter(d=>d.x != null && d.y != null), borderColor, borderWidth: 1.5, pointRadius: 0, tension: 0.1 });
    });

    for (const [id, playerInfo] of careerChartState.highlightedPlayers.entries()) {
        let highlightedData = playerHistoryCache[id]?.performanceHistory;
        if (highlightedData) {
            if (minutesFilter === '15_game') highlightedData = highlightedData.filter(d => d.MIN >= 15);
            if (highlightedData.length > 0) datasets.push({ label: playerInfo.name, data: highlightedData.map(d => ({ x: d[xAxis], y: d[stat] })).filter(d=>d.x != null && d.y != null), borderColor: playerInfo.color, borderWidth: 3, pointRadius: 0, tension: 0.1, order: -10 });
        }
    }
    
    careerChartInstance = new Chart(ctx, { type: 'line', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: 'var(--text-primary)', filter: item => !item.label.startsWith('Player ') } }, decimation: { enabled: true, algorithm: 'lttb', samples: colorByTeam ? 500 : 200 } }, scales: { x: { type: 'linear', title: { display: true, text: xAxis === 'age' ? 'Player Age' : 'WNBA Games Played' } }, y: { title: { display: true, text: stat } } } } });
}
