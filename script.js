// script.js (v35.0 - Final, Complete, and Verified)

// --- GLOBAL STATE & CONFIGURATION ---
let fullData = { modelNames: [] };
let loadedSeasonDataCache = {};
let currentSort = { column: "custom_z_score_display", direction: "desc" };
let accuracyChartInstance = null;
let careerChartInstance = null;
let modalChartInstance = null;
let dailyProjectionState = { mode: 'single', selectedModel: 'Ensemble', blendWeights: {} };

const STAT_CONFIG = { PTS: { name: "PTS", zKey: "z_PTS" }, REB: { name: "REB", zKey: "z_REB" }, AST: { name: "AST", zKey: "z_AST" }, STL: { name: "STL", zKey: "z_STL" }, BLK: { name: "BLK", zKey: "z_BLK" }, '3PM': { name: "3PM", zKey: "z_3PM" }, TOV: { name: "TOV", zKey: "z_TOV" }, FG_impact: { name: "FG%", zKey: "z_FG_impact" }, FT_impact: { name: "FT%", zKey: "z_FT_impact" } };
const ALL_STAT_KEYS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TOV", "FG_impact", "FT_impact"];
const BLENDABLE_STATS = ['points', 'reb', 'ast'];
const MODAL_CHART_STATS = { PTS: "Points", REB: "Rebounds", AST: "Assists", STL: "Steals", BLK: "Blocks", '3PM': "3-Pointers" };
const MODEL_COLORS = ['#0d6efd', '#6f42c1', '#198754', '#ffc107', '#dc3545', '#0dcaf0'];

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
    initializeTheme();
    try {
        const response = await fetch("predictions.json");
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const rawData = await response.json();
        
        const firstDate = Object.keys(rawData.dailyGamesByDate || {})[0];
        if (firstDate && rawData.dailyGamesByDate[firstDate].length > 0) {
            const firstGame = rawData.dailyGamesByDate[firstDate][0];
            if (firstGame.projections) {
                fullData.modelNames = Object.keys(firstGame.projections);
            }
        }
        if(fullData.modelNames.length === 0) { fullData.modelNames = ['Ensemble']; }
        dailyProjectionState.selectedModel = fullData.modelNames.includes('Ensemble') ? 'Ensemble' : fullData.modelNames[0];

        fullData = { ...fullData, ...rawData };
        document.getElementById("last-updated").textContent = new Date(fullData.lastUpdated).toLocaleString();
        
        initializeSeasonTab();
        initializeDailyTab();
        initializeTeamAnalysisTab();
        initializePlayerProgressionTab();
        initializeCareerAnalysisTab();

        document.body.addEventListener('click', handleGlobalClicks);
        document.querySelector('.tab-link').click();

    } catch (e) {
        console.error("FATAL: Failed to initialize application.", e);
        document.body.innerHTML = `<div style="text-align:center; padding: 50px; font-size:1.2em;">Error: Could not load core application data. Please check the browser console (F12) for details. The 'predictions.json' file may be missing or corrupt.<br><br><i>${e.message}</i></div>`;
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
    } catch (e) { console.error(e); return null; }
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
async function showPlayerProfileOverlay(profile) {
    const personId = profile.personId;
    const overlay = document.getElementById("player-profile-overlay");
    overlay.innerHTML = buildPlayerProfileModalHTML(profile);
    overlay.classList.add("visible");
    
    const renderContent = async () => {
        const statlineToggle = overlay.querySelector('#statline-toggle-checkbox').checked;
        const careerCurveToggle = overlay.querySelector('#career-curve-toggle-checkbox').checked;
        const mainHeader = overlay.querySelector('.profile-main-header h3');
        const chartControlsContainer = overlay.querySelector('.modal-chart-view-controls');
        const chartContainer = document.getElementById('modal-chart-container');
        
        chartContainer.innerHTML = ''; 

        if (statlineToggle) {
            chartControlsContainer.style.display = 'none';
            await renderPlayerStatlineView(personId, chartContainer);
        } else {
            chartControlsContainer.style.display = 'block';
            if (careerCurveToggle) {
                mainHeader.textContent = 'Career Curve (3-Month Rolling Avg)';
                overlay.querySelector('.controls-card').style.display = 'none';
                await renderPlayerCareerCurveChart(personId, chartContainer);
            } else {
                const statName = MODAL_CHART_STATS[overlay.querySelector('#modal-stat-selector')?.value || 'PTS'];
                mainHeader.textContent = `Performance & Projections: ${statName}`;
                overlay.querySelector('.controls-card').style.display = 'block';
                await renderPlayerPerformanceHistoryChart(profile, chartContainer);
            }
        }
    };

    overlay.querySelector('#statline-toggle-checkbox').addEventListener('change', renderContent);
    overlay.querySelector('#career-curve-toggle-checkbox').addEventListener('change', renderContent);
    overlay.querySelector('#modal-chart-controls').addEventListener('change', renderContent);

    const closeModal = () => {
        overlay.classList.remove("visible");
        overlay.innerHTML = '';
        if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
    };

    overlay.querySelector(".modal-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });

    await renderContent();
}

function buildPlayerProfileModalHTML(profile) {
    const wikiLink = profile.wikiUrl ? `<a href="${profile.wikiUrl}" target="_blank" rel="noopener noreferrer">View on Wikipedia</a>` : 'N/A';
    const statSelectorOptions = Object.entries(MODAL_CHART_STATS).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
    const modelToggles = fullData.modelNames.map(name => `
        <div class="chart-toggle">
            <span class="chart-toggle-label">${name}</span>
            <label class="chart-toggle-switch">
                <input type="checkbox" class="modal-model-toggle" data-model="${name}" checked>
                <span class="chart-toggle-slider"></span>
            </label>
        </div>
    `).join('');
    
    return `
    <div class="grade-modal player-modal">
        <div class="modal-header">
            <h2>${profile.playerName || 'Unknown Player'}</h2>
            <div class="modal-toggles">
                <div class="chart-toggle">
                    <span class="chart-toggle-label">Full Stat Line</span>
                    <label class="chart-toggle-switch"><input type="checkbox" id="statline-toggle-checkbox"><span class="chart-toggle-slider"></span></label>
                </div>
            </div>
            <button class="modal-close">×</button>
        </div>
        <div class="player-profile-grid">
            <div class="profile-sidebar">
                <div class="profile-info-grid">
                    <div class="profile-info-item"><div class="profile-info-label">Position</div><div class="profile-info-value">${profile.position || 'N/A'}</div></div>
                    <div class="profile-info-item"><div class="profile-info-label">Height</div><div class="profile-info-value">${profile.height || 'N/A'}</div></div>
                    <div class="profile-info-item"><div class="profile-info-label">Weight</div><div class="profile-info-value">${profile.weight || 'N/A'}</div></div>
                    <div class="profile-info-item"><div class="profile-info-label">Team</div><div class="profile-info-value">${profile.team || 'N/A'}</div></div>
                    <div class="profile-info-item"><div class="profile-info-label">Draft Info</div><div class="profile-info-value">${profile.draftInfo || 'N/A'}</div></div>
                    <div class="profile-info-item"><div class="profile-info-label">External Link</div><div class="profile-info-value">${wikiLink}</div></div>
                </div>
            </div>
            <div class="profile-main">
                <div class="modal-chart-view-controls">
                    <div class="profile-main-header">
                        <h3>Performance Chart</h3>
                        <div class="chart-toggle chart-toggle-container">
                            <span class="chart-toggle-label">Career Curve</span>
                            <label class="chart-toggle-switch"><input type="checkbox" id="career-curve-toggle-checkbox"><span class="chart-toggle-slider"></span></label>
                        </div>
                    </div>
                    <div class="controls-card">
                        <div id="modal-chart-controls" class="modal-chart-controls">
                            <div class="filter-group">
                                <label for="modal-stat-selector">STATISTIC</label>
                                <select id="modal-stat-selector">${statSelectorOptions}</select>
                            </div>
                            <div class="modal-model-toggles">${modelToggles}</div>
                        </div>
                    </div>
                </div>
                <div class="chart-wrapper" id="modal-chart-container"></div>
            </div>
        </div>
    </div>`;
}

async function renderPlayerStatlineView(personId, container) {
    if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
    container.innerHTML = `<div class="statline-placeholder"><p>Loading historical data...</p></div>`;
    const historicalSources = Object.keys(fullData.seasonLongDataManifest).filter(k => k.startsWith('actuals_') && k.endsWith('_per_game')).sort().reverse();
    let allStats = [];
    for (const sourceKey of historicalSources) {
        const seasonData = await fetchSeasonData(sourceKey);
        const playerData = seasonData?.find(p => p.personId === personId);
        if (playerData) { allStats.push({ season: fullData.seasonLongDataManifest[sourceKey].label.replace(' Full Season', ''), ...playerData }); }
    }
    if (allStats.length === 0) { container.innerHTML = `<div class="statline-placeholder"><p>No historical data found for this player.</p></div>`; return; }
    const tableHeaders = ['Season', 'Team', 'GP', 'MPG', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TOV', 'FG%', 'FT%'];
    container.innerHTML = `<div class="table-container modal-table"><table><thead><tr>${tableHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${allStats.map(s => `<tr><td>${s.season || 'N/A'}</td><td>${s.team || 'N/A'}</td><td>${(s.GP || 0).toFixed(0)}</td><td>${(s.MIN || 0).toFixed(1)}</td><td>${(s.PTS || 0).toFixed(1)}</td><td>${(s.REB || 0).toFixed(1)}</td><td>${(s.AST || 0).toFixed(1)}</td><td>${(s.STL || 0).toFixed(1)}</td><td>${(s.BLK || 0).toFixed(1)}</td><td>${(s['3PM'] || 0).toFixed(1)}</td><td>${(s.TOV || 0).toFixed(1)}</td><td>${(s.FGA > 0 ? (s.FGM / s.FGA * 100) : 0).toFixed(1)}%</td><td>${(s.FTA > 0 ? (s.FTM / s.FTA * 100) : 0).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`;
}

async function renderPlayerPerformanceHistoryChart(profile, container) {
    const statKey = document.getElementById('modal-stat-selector')?.value || 'PTS';
    const statName = MODAL_CHART_STATS[statKey];

    if (modalChartInstance) modalChartInstance.destroy();
    container.innerHTML = '<canvas id="modal-chart"></canvas>';
    const ctx = container.querySelector('canvas')?.getContext('2d');
    if (!ctx) return;

    const datasets = [];
    const history = profile.performanceHistory || [];

    if (history.length > 0) {
        const actualData = history
            .map(d => ({ x: new Date(d.date + "T00:00:00").valueOf(), y: d[statKey] }))
            .filter(d => d.y != null);
        if (actualData.length > 0) {
            datasets.push({
                label: 'Actual', data: actualData, borderColor: 'var(--text-primary)', backgroundColor: 'var(--text-primary)',
                type: 'scatter', pointRadius: 5, order: -10
            });
        }
    }

    const futureProjections = profile.futureProjections || [];
    const activeModels = new Set(Array.from(document.querySelectorAll('.modal-model-toggle:checked')).map(el => el.dataset.model));

    fullData.modelNames.forEach((modelName, i) => {
        if (!activeModels.has(modelName)) return;
        const modelData = futureProjections
            .filter(p => p.model_source === modelName && p[statKey] != null)
            .map(p => ({ x: new Date(p.game_date + "T00:00:00").valueOf(), y: p[statKey] }));
        if (modelData.length > 0) {
            datasets.push({
                label: modelName, data: modelData, borderColor: MODEL_COLORS[i % MODEL_COLORS.length], backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length],
                fill: false, tension: 0.1, type: 'line'
            });
        }
    });
    
    if (datasets.length === 0) {
        container.innerHTML = '<div class="statline-placeholder"><p>No data available for the selected statistic and models.</p></div>';
        return;
    }

    modalChartInstance = new Chart(ctx, {
        type: 'line', data: { datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { type: 'time', time: { unit: 'day', tooltipFormat: 'MMM d, yyyy' }, title: { display: true, text: 'Date' } },
                y: { title: { display: true, text: statName }, beginAtZero: true }
            },
            plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

async function renderPlayerCareerCurveChart(personId, container) {
    if (modalChartInstance) modalChartInstance.destroy();
    container.innerHTML = '<canvas id="modal-chart"></canvas>';
    const ctx = container.querySelector('canvas')?.getContext('2d');
    if (!ctx) return;
    
    const careerData = await fetchSeasonData('career_data');
    const playerData = careerData?.players?.[String(personId)];
    if (!playerData || playerData.length === 0) {
        container.innerHTML = '<div class="statline-placeholder"><p>No long-term career data available for this player.</p></div>';
        return;
    }
    
    modalChartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ label: 'Monthly PTS Average', data: playerData.map(d => ({ x: d.x_games, y: d.PTS })), borderColor: 'var(--primary-color)', backgroundColor: 'var(--primary-color)', tension: 0.1, fill: false }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'linear', title: { display: true, text: 'WNBA Games Played' } }, y: { title: { display: true, text: 'Points Per Game' } } } }
    });
}

// --- SEASON-LONG TAB ---
function initializeSeasonTab() {
    const manifest = fullData.seasonLongDataManifest || {};
    const seasonSelector = document.getElementById("season-selector");
    const sourcesBySeason = {};
    for (const key in manifest) {
        const match = key.match(/(projections_(\d{4})|actuals_(\d{4}))/);
        if (!match) continue;
        const year = match[2] || match[3];
        if (!sourcesBySeason[year]) {
            sourcesBySeason[year] = { key: key.replace(/_per_game|_total$/, ''), label: manifest[key].label, split: manifest[key].split };
        }
    }
    const sortedSeasons = Object.keys(sourcesBySeason).sort((a, b) => b.localeCompare(a));
    seasonSelector.innerHTML = sortedSeasons.map(year => `<option value="${year}">${sourcesBySeason[year].label}</option>`).join('');
    document.getElementById("split-selector").parentElement.style.display = 'none';
    document.getElementById("category-weights-grid").innerHTML = ALL_STAT_KEYS.map(key => `<div class="category-item"><label><input type="checkbox" data-key="${key}" checked> ${STAT_CONFIG[key].name}</label></div>`).join('');
    document.getElementById("season-controls")?.addEventListener("change", renderSeasonTable);
    document.getElementById("search-player")?.addEventListener("input", renderSeasonTable);
    document.getElementById("predictions-thead")?.addEventListener("click", handleSortSeason);
    renderSeasonTable();
}

async function renderSeasonTable() {
    const selectedYear = document.getElementById("season-selector").value;
    const manifest = fullData.seasonLongDataManifest || {};
    const sourceKeyPrefix = Object.keys(manifest).find(k => k.includes(selectedYear));
    if (!sourceKeyPrefix) {
        console.error(`No manifest entry found for year: ${selectedYear}`);
        return;
    }
    const calcMode = document.getElementById("calculation-mode").value;
    const sourceKey = sourceKeyPrefix.replace(/per_game|total$/, calcMode);
    const settings = {
        showCount: parseInt(document.getElementById("show-count").value, 10),
        searchTerm: document.getElementById("search-player").value.toLowerCase().trim(),
        activeCategories: new Set(Array.from(document.querySelectorAll("#category-weights-grid input:checked")).map(cb => cb.dataset.key))
    };
    const tbody = document.getElementById("predictions-tbody");
    tbody.innerHTML = `<tr><td colspan="17" style="text-align:center;">Loading player data...</td></tr>`;
    let data = await fetchSeasonData(sourceKey);
    if (!data) {
        tbody.innerHTML = `<tr><td colspan="17" class="error-cell">Could not load data. Check console for details.</td></tr>`;
        return;
    }
    let processedData = data.map(player => ({
        ...player,
        custom_z_score_display: Array.from(settings.activeCategories).reduce((acc, catKey) => acc + (player[STAT_CONFIG[catKey].zKey] || 0), 0)
    }));
    if (settings.searchTerm) {
        processedData = processedData.filter(p => p.playerName?.toLowerCase().includes(settings.searchTerm));
    }
    currentSort.data = processedData;
    currentSort.column = 'custom_z_score_display';
    currentSort.direction = 'desc';
    sortSeasonData();
    renderSeasonTableBody(settings.showCount);
}

function handleSortSeason(e) {
    const th = e.target.closest("th");
    const sortKey = th?.dataset.sortKey;
    if (!sortKey) return;
    if (currentSort.column === sortKey) {
        currentSort.direction = currentSort.direction === "desc" ? "asc" : "desc";
    } else {
        currentSort.column = sortKey;
        currentSort.direction = ["playerName", "position", "team"].includes(sortKey) ? "asc" : "desc";
    }
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
    const thead = document.getElementById("predictions-thead");
    thead.innerHTML = `<tr><th>R#</th><th data-sort-key="playerName">Player</th><th data-sort-key="position">Pos</th><th data-sort-key="team">Team</th><th data-sort-key="GP">GP</th><th data-sort-key="MIN">MPG</th>${ALL_STAT_KEYS.map(k=>`<th data-sort-key="${STAT_CONFIG[k].zKey}">${STAT_CONFIG[k].name}</th>`).join('')}<th data-sort-key="custom_z_score_display">TOTAL▼</th></tr>`;
    document.querySelectorAll('#predictions-thead th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
    const currentTh = thead.querySelector(`[data-sort-key="${currentSort.column}"]`);
    if (currentTh) currentTh.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    const tbody = document.getElementById("predictions-tbody");
    const dataToRender = currentSort.data?.slice(0, showCount) || [];
    if (!dataToRender.length) {
        tbody.innerHTML = `<tr><td colspan="17" class="error-cell">No players match criteria.</td></tr>`;
        return;
    }
    const getZClass = z => z >= 1.5 ? 'elite' : z >= 1.0 ? 'very-good' : z >= 0.5 ? 'good' : z <= -1.0 ? 'not-good' : z <= -0.5 ? 'below-average' : 'average';
    const isTotalMode = document.getElementById("calculation-mode").value === 'total';
    tbody.innerHTML = dataToRender.map((p, i) => `<tr><td>${i + 1}</td><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName || 'N/A'}</a></td><td>${p.position || 'N/A'}</td><td>${p.team || 'N/A'}</td><td>${(p.GP || 0).toFixed(0)}</td><td>${(p.MIN || 0).toFixed(1)}</td>${ALL_STAT_KEYS.map(key => { const zKey = STAT_CONFIG[key].zKey; const zValue = p[zKey] || 0; let displayValue; const rawKey = key.replace('_impact', ''); const value = p[rawKey] || 0; if (key.includes('_impact')) { const made = key === 'FG_impact' ? p.FGM : p.FTM; const att = key === 'FG_impact' ? p.FGA : p.FTA; displayValue = (att !== undefined && att > 0) ? (made / att).toFixed(3) : (p[key.replace('_impact', '_pct')] || 0).toFixed(3); } else { displayValue = value.toFixed(isTotalMode ? 0 : 1); } return `<td class="stat-cell ${getZClass(zValue)}"><span class="stat-value">${displayValue}</span><span class="z-score-value">${(zValue || 0).toFixed(2)}</span></td>`; }).join('')}<td>${(p.custom_z_score_display || 0).toFixed(2)}</td></tr>`).join('');
}


// --- DAILY PROJECTIONS TAB ---
function initializeDailyTab() {
    const modelSelector = document.getElementById("daily-model-selector");
    const blendWeightsGrid = document.getElementById("daily-blend-weights-grid");
    modelSelector.innerHTML = fullData.modelNames.map(name => `<option value="${name}">${name}</option>`).join('');
    modelSelector.value = dailyProjectionState.selectedModel;
    blendWeightsGrid.innerHTML = fullData.modelNames.map(name => {
        const isDefault = name === dailyProjectionState.selectedModel;
        dailyProjectionState.blendWeights[name] = isDefault ? 100 : 0;
        return `<div class="category-item"><label><span>${name}</span><input type="number" class="blend-weight-input" data-model="${name}" value="${isDefault ? 100 : 0}" min="0" step="1"> %</label></div>`;
    }).join('');
    document.getElementById('mode-single-btn').addEventListener('click', () => setDailyProjectionMode('single'));
    document.getElementById('mode-blend-btn').addEventListener('click', () => setDailyProjectionMode('blend'));
    document.getElementById('daily-model-selector').addEventListener('change', (e) => { dailyProjectionState.selectedModel = e.target.value; updateDailyGamesView(); });
    document.querySelectorAll('.blend-weight-input').forEach(input => {
        input.addEventListener('change', (e) => { dailyProjectionState.blendWeights[e.target.dataset.model] = parseFloat(e.target.value) || 0; updateDailyGamesView(); });
    });
    document.getElementById('normalize-weights-btn').addEventListener('click', () => {
        const totalWeight = Object.values(dailyProjectionState.blendWeights).reduce((a, b) => a + b, 0);
        if (totalWeight > 0) {
            document.querySelectorAll('.blend-weight-input').forEach(input => {
                const model = input.dataset.model;
                const newWeight = Math.round((dailyProjectionState.blendWeights[model] / totalWeight) * 100);
                dailyProjectionState.blendWeights[model] = newWeight;
                input.value = newWeight;
            });
            updateDailyGamesView();
        }
    });
    document.getElementById("accuracy-metric-selector").addEventListener('change', renderAccuracyChart);
    const dateTabs = document.getElementById("daily-date-tabs");
    const sortedDates = fullData.dailyGamesByDate ? Object.keys(fullData.dailyGamesByDate).sort((a, b) => new Date(a) - new Date(b)) : [];
    if (!sortedDates.length) {
        document.getElementById("daily-games-container").innerHTML = '<div class="card"><p>No daily predictions available.</p></div>';
        document.getElementById("accuracy-chart-container").style.display = 'none';
        document.getElementById("daily-projection-controls").style.display = 'none';
        return;
    }
    dateTabs.innerHTML = sortedDates.map((date) => `<button class="date-tab" data-date="${date}">${new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</button>`).join('');
    dateTabs.addEventListener("click", e => {
        const tab = e.target.closest(".date-tab");
        if (tab && !tab.classList.contains('active')) {
            document.querySelectorAll(".date-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            renderDailyGamesForDate(tab.dataset.date);
        }
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let activeTab = Array.from(dateTabs.children).find(tab => new Date(tab.dataset.date + "T00:00:00") >= today) || dateTabs.children[dateTabs.children.length - 1];
    if (activeTab) {
        activeTab.classList.add("active");
        renderDailyGamesForDate(activeTab.dataset.date);
    }
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
        renderAccuracyChart();
    }
}

function getActiveProjection(allModelProjections) {
    if (dailyProjectionState.mode === 'single') {
        return allModelProjections[dailyProjectionState.selectedModel] || Object.values(allModelProjections)[0];
    }
    const totalWeight = Object.values(dailyProjectionState.blendWeights).reduce((a, b) => a + b, 0);
    if (totalWeight === 0) {
        return allModelProjections[dailyProjectionState.selectedModel] || Object.values(allModelProjections)[0];
    }
    const firstModel = Object.values(allModelProjections)[0];
    const blendedProjection = [
        { teamName: firstModel[0].teamName, totalPoints: 0, players: [] },
        { teamName: firstModel[1].teamName, totalPoints: 0, players: [] }
    ];
    const allPlayersMap = new Map();
    for (const modelName of fullData.modelNames) {
        const weight = dailyProjectionState.blendWeights[modelName] || 0;
        if (weight === 0 || !allModelProjections[modelName]) continue;
        const modelProjection = allModelProjections[modelName];
        [0, 1].forEach(teamIndex => {
            for (const player of modelProjection[teamIndex].players) {
                if (!allPlayersMap.has(player.personId)) {
                    allPlayersMap.set(player.personId, { data: player, teamIndex: teamIndex, weightedStats: {}, totalWeight: 0 });
                }
                const playerEntry = allPlayersMap.get(player.personId);
                for (const stat of BLENDABLE_STATS) {
                    if (typeof player[stat] === 'number') {
                        playerEntry.weightedStats[stat] = (playerEntry.weightedStats[stat] || 0) + (player[stat] * weight);
                    }
                }
                playerEntry.totalWeight += weight;
            }
        });
    }
    for (const [personId, playerEntry] of allPlayersMap.entries()) {
        const finalPlayer = { ...playerEntry.data };
        for (const stat of BLENDABLE_STATS) {
            if (playerEntry.totalWeight > 0) {
                finalPlayer[stat] = (playerEntry.weightedStats[stat] || 0) / playerEntry.totalWeight;
            }
        }
        blendedProjection[playerEntry.teamIndex].players.push(finalPlayer);
    }
    [0, 1].forEach(teamIndex => {
        blendedProjection[teamIndex].totalPoints = blendedProjection[teamIndex].players.reduce((sum, p) => sum + (p.points || 0), 0);
        blendedProjection[teamIndex].players.sort((a, b) => (b.Predicted_Minutes || 0) - (a.Predicted_Minutes || 0));
    });
    return blendedProjection;
}

function renderDailyGamesForDate(date) {
    const container = document.getElementById("daily-games-container");
    const games = fullData.dailyGamesByDate?.[date] || [];
    if (games.length === 0) {
        container.innerHTML = '<div class="card"><p>No games for this date.</p></div>';
        return;
    }
    const getBadgeClass = pts => pts > 20 ? 'elite' : pts > 15 ? 'very-good' : pts > 10 ? 'good' : 'average';
    container.innerHTML = games.map(game => {
        const activeProjection = getActiveProjection(game.projections);
        if (!activeProjection || activeProjection.length < 2) {
            console.warn("Could not get a valid projection for a game, skipping render.", game);
            return '';
        }
        const [team1, team2] = activeProjection;
        let scoreHTML = `Predicted: <strong>${Math.round(team1.totalPoints)} - ${Math.round(team2.totalPoints)}</strong>`;
        if (game.grade?.isGraded) {
            const actualSummary = game.grade.gameSummary.actual;
            const team1Abbr = Object.keys(actualSummary).find(abbr => REVERSE_TEAM_MAP[abbr] === team1.teamName);
            const team2Abbr = Object.keys(actualSummary).find(abbr => REVERSE_TEAM_MAP[abbr] === team2.teamName);
            const actual1 = actualSummary[team1Abbr] || 0;
            const actual2 = actualSummary[team2Abbr] || 0;
            const modelGrades = game.grade.model_grades['Ensemble'] || {};
            const predScores = modelGrades.predicted_scores || {};
            const correctWinnerClass = modelGrades.correctWinner ? 'prediction-correct' : 'prediction-incorrect';
            scoreHTML = `Predicted: <strong class="${correctWinnerClass}">${Math.round(team1.totalPoints)} - ${Math.round(team2.totalPoints)}</strong><span class="actual-score">Actual: <strong>${actual1} - ${actual2}</strong></span>`;
        }
        const createCompactSummary = (teamData) => (teamData.players || []).sort((a, b) => (b.Predicted_Minutes || 0) - (a.Predicted_Minutes || 0)).slice(0, 5).map(p => `<div class="compact-player-badge ${getBadgeClass(p.points)}" title="${p.Player_Name} (Proj. ${p.points.toFixed(1)} pts)">${p.Player_Name.split(' ').pop()}</div>`).join('');
        return `<div class="matchup-card"><div class="matchup-header"><span class="matchup-teams">${team1.teamName} vs ${team2.teamName}</span><div class="matchup-scores">${scoreHTML}</div></div><div class="matchup-compact-summary"><div class="compact-team">${createCompactSummary(team1)}</div><div class="compact-team">${createCompactSummary(team2)}</div></div><div class="matchup-body">${createTeamTableHTML(team1, game.grade)}${createTeamTableHTML(team2, game.grade)}</div><div class="matchup-footer"><button class="button-outline expand-details-btn">Show Details</button></div></div>`;
    }).join('');
}

function createTeamTableHTML(teamData, gameGrade) {
    const isGraded = gameGrade?.isGraded;
    const getPerfIndicator = (pred, actual) => { if (actual == null || pred == null) return ''; const diff = Math.abs(pred - actual), relativeError = diff / (actual || pred || 1); if (relativeError < 0.20) return 'pi-good'; if (relativeError > 0.60 && diff > 3) return 'pi-bad'; return 'pi-neutral'; };
    const playersHtml = (teamData.players || []).map(p => {
        const nameHtml = `<a href="#" class="player-link" data-person-id="${p.personId}">${p.Player_Name}</a>`;
        let predRow, actualRow = '';
        if (isGraded) {
            const actuals = gameGrade.playerActuals?.[p.personId];
            predRow = `<tr class="player-row-pred"><td rowspan="2" class="player-name-cell">${nameHtml}</td><td class="stat-type-cell">P</td><td>${(p.Predicted_Minutes || 0).toFixed(1)}</td><td>${(p.points || 0).toFixed(1)}</td><td>${(p.reb || 0).toFixed(1)}</td><td>${(p.ast || 0).toFixed(1)}</td></tr>`;
            if (actuals) {
                actualRow = `<tr class="player-row-actual"><td class="stat-type-cell">A</td><td>-</td><td>${actuals.PTS.toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.points, actuals.PTS)}"></span></td><td>${actuals.REB.toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.reb, actuals.REB)}"></span></td><td>${actuals.AST.toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.ast, actuals.AST)}"></span></td></tr>`;
            } else {
                actualRow = `<tr class="player-row-actual"><td colspan="5" style="text-align:center; color: var(--text-secondary);">DNP</td></tr>`;
            }
        } else {
            predRow = `<tr class="player-row-pred"><td class="player-name-cell">${nameHtml}</td><td class="stat-type-cell">P</td><td>${(p.Predicted_Minutes || 0).toFixed(1)}</td><td>${(p.points || 0).toFixed(1)}</td><td>${(p.reb || 0).toFixed(1)}</td><td>${(p.ast || 0).toFixed(1)}</td></tr>`;
        }
        return predRow + actualRow;
    }).join('');
    return `<div class="team-box-score"><h3 class="team-header">${teamData.teamName}</h3><table class="daily-table"><thead><tr><th style="text-align:left;">Player</th><th></th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>${playersHtml}</tbody></table></div>`;
}

function renderAccuracyChart() {
    const container = document.getElementById("accuracy-chart-container");
    if (!container) return;
    const chartCanvas = document.getElementById('accuracy-chart');
    if (!chartCanvas || !fullData.historicalGrades || fullData.historicalGrades.length < 1) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    const ctx = chartCanvas.getContext('2d');
    const metric = document.getElementById('accuracy-metric-selector').value;
    const gradesByDate = fullData.historicalGrades.reduce((acc, g) => {
        (acc[g.date] = acc[g.date] || []).push(g);
        return acc;
    }, {});
    const sortedDates = Object.keys(gradesByDate).sort((a, b) => new Date(a) - new Date(b));
    const datasets = [];
    const modelColors = ['#0d6efd', '#6f42c1', '#198754', '#ffc107', '#dc3545', '#0dcaf0'];

    fullData.modelNames.forEach((modelName, i) => {
        const data = sortedDates.map(date => {
            const dayGrades = gradesByDate[date].map(g => g.model_grades[modelName]).filter(Boolean);
            if (dayGrades.length === 0) return null;
            if (metric === 'cumulativeWinLoss') return null;
            if (metric === 'dailyWinLoss') {
                const wins = dayGrades.reduce((s, g) => s + (g.correctWinner ? 1 : 0), 0);
                return dayGrades.length > 0 ? (wins / dayGrades.length) * 100 : 0;
            }
            const values = dayGrades.map(g => g[metric]).filter(v => v !== undefined && v !== null && !isNaN(v));
            return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        }).filter(v => v !== null);
        if (metric === 'cumulativeWinLoss') {
            let wins = 0, total = 0;
            const cumulativeData = sortedDates.map(date => {
                const dayGrades = gradesByDate[date].map(g => g.model_grades[modelName]).filter(Boolean);
                wins += dayGrades.reduce((s, g) => s + (g.correctWinner ? 1 : 0), 0);
                total += dayGrades.length;
                return total > 0 ? (wins / total) * 100 : 0;
            });
            datasets.push({ label: modelName, data: cumulativeData, borderColor: modelColors[i % modelColors.length], tension: 0.1, fill: false });
        } else {
            datasets.push({ label: modelName, data, backgroundColor: modelColors[i % modelColors.length] });
        }
    });

    if (dailyProjectionState.mode === 'blend') {
        const totalWeight = Object.values(dailyProjectionState.blendWeights).reduce((a, b) => a + b, 0);
        if (totalWeight > 0) {
            const blendData = sortedDates.map(date => {
                const dayGrades = gradesByDate[date];
                if (dayGrades.length === 0) return null;
                const blendValues = dayGrades.map(gameGrade => {
                    let blendedMetricValue = 0;
                    for (const modelName of fullData.modelNames) {
                        const weight = dailyProjectionState.blendWeights[modelName] || 0;
                        const modelGrade = gameGrade.model_grades[modelName];
                        if (weight > 0 && modelGrade && typeof modelGrade[metric] === 'number' && !isNaN(modelGrade[metric])) {
                            blendedMetricValue += modelGrade[metric] * weight;
                        }
                    }
                    return blendedMetricValue / totalWeight;
                });
                const validValues = blendValues.filter(v => v !== null && !isNaN(v));
                return validValues.length > 0 ? validValues.reduce((a,b) => a+b, 0) / validValues.length : null;
            }).filter(v => v !== null);
            if (metric !== 'cumulativeWinLoss' && metric !== 'dailyWinLoss') {
                datasets.push({ label: 'Current Blend', data: blendData, backgroundColor: 'var(--text-primary)' });
            }
        }
    }
    
    let chartConfig;
    const isCumulative = metric === 'cumulativeWinLoss';
    if (isCumulative) {
        chartConfig = { type: 'line', data: { labels: sortedDates.map(d => new Date(d + "T00:00:00").toLocaleDateString('en-US', { month: 'short', day: 'numeric' })), datasets: datasets }, options: { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } } };
    } else {
        chartConfig = { type: 'bar', data: { labels: sortedDates.map(d => new Date(d + "T00:00:00").toLocaleDateString('en-US', { month: 'short', day: 'numeric' })), datasets: datasets }, options: metric === 'dailyWinLoss' ? { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } } : {} };
    }
    if (accuracyChartInstance) accuracyChartInstance.destroy();
    accuracyChartInstance = new Chart(ctx, { ...chartConfig, options: { ...chartConfig.options, responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
}

// --- OTHER TABS ---
function initializeTeamAnalysisTab() { const selector = document.getElementById("team-analysis-source-selector"); const manifest = fullData.seasonLongDataManifest || {}; const sources = Object.keys(manifest).filter(key => key.endsWith('_per_game')).sort((a,b) => b.localeCompare(a)); selector.innerHTML = sources.map(key => `<option value="${key}">${manifest[key].label}</option>`).join(''); selector.addEventListener('change', renderTeamAnalysis); renderTeamAnalysis(); }
async function renderTeamAnalysis() { const container = document.getElementById("team-analysis-container"); container.innerHTML = '<div class="card"><p>Loading team data...</p></div>'; const sourceKey = document.getElementById("team-analysis-source-selector").value; const data = await fetchSeasonData(sourceKey); if (!data) { container.innerHTML = '<div class="card"><p class="error-cell">Could not load data.</p></div>'; return; } const teams = data.reduce((acc, p) => { (acc[p.team || 'FA'] = acc[p.team || 'FA'] || []).push(p); return acc; }, {}); container.innerHTML = Object.entries(teams).sort(([teamA], [teamB]) => { if (teamA === 'FA') return 1; if (teamB === 'FA') return -1; const strengthA = teams[teamA].reduce((s, p) => s + (p.custom_z_score || 0), 0); const strengthB = teams[teamB].reduce((s, p) => s + (p.custom_z_score || 0), 0); return strengthB - strengthA; }).map(([teamName, players]) => { const teamStrength = players.reduce((sum, p) => sum + (p.custom_z_score || 0), 0); const playerRows = players.sort((a,b) => (b.custom_z_score || 0) - (a.custom_z_score || 0)).map(p => `<tr><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName || 'undefined'}</a></td><td>${(p.GP||0).toFixed(0)}</td><td>${(p.MIN||0).toFixed(1)}</td><td>${(p.PTS||0).toFixed(1)}</td><td>${(p.REB||0).toFixed(1)}</td><td>${(p.AST||0).toFixed(1)}</td><td>${(p.custom_z_score||0).toFixed(2)}</td></tr>`).join(''); return ` <div class="team-card"> <div class="team-card-header"><h3>${teamName === 'FA' ? 'Free Agents' : teamName}</h3><div class="team-strength-score">${teamStrength.toFixed(2)}</div></div> <div class="table-container"> <table> <thead><tr><th>Player</th><th>GP</th><th>MPG</th><th>PTS</th><th>REB</th><th>AST</th><th>Z-Score</th></tr></thead> <tbody>${playerRows}</tbody> </table> </div> </div>`; }).join(''); }
async function initializePlayerProgressionTab() { const container = document.getElementById("player-progression-container"); container.innerHTML = '<div class="card" style="padding:20px; text-align:center;">Loading...</div>'; const futureData = await fetchSeasonData('progression'); const historicalData = await fetchSeasonData('progression_historical'); if (!futureData && !historicalData) { container.innerHTML = '<div class="card"><p class="error-cell">Could not load progression data.</p></div>'; return; } let html = ''; if (futureData) { html += createProgressionTable('Top Risers (vs. \'25 Proj.)', [...futureData].sort((a,b)=>b.z_Change-a.z_Change).slice(0,15), "'24 Z","'25 Proj. Z", "z_Total_2024", "z_Total_2025_Proj"); html += createProgressionTable('Top Fallers (vs. \'25 Proj.)', [...futureData].sort((a,b)=>a.z_Change-b.z_Change).slice(0,15), "'24 Z","'25 Proj. Z", "z_Total_2024", "z_Total_2025_Proj"); } if (historicalData) { html += createProgressionTable('Top Risers (\'23 vs \'24)', [...historicalData].sort((a,b)=>b.z_Change-a.z_Change).slice(0,15), "'23 Z","'24 Z", "z_Total_2023", "z_Total_2024"); html += createProgressionTable('Top Fallers (\'23 vs \'24)', [...historicalData].sort((a,b)=>a.z_Change-b.z_Change).slice(0,15), "'23 Z","'24 Z", "z_Total_2023", "z_Total_2024"); } container.innerHTML = html; }
function createProgressionTable(title, players, th1, th2, key1, key2) { const rows = players.map(p => `<tr><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName}</a></td><td>${p.team}</td><td>${(p[key1]||0).toFixed(2)}</td><td>${(p[key2]||0).toFixed(2)}</td><td class="${p.z_Change>=0?'text-success':'text-danger'}">${p.z_Change>=0?'+':''}${(p.z_Change||0).toFixed(2)}</td></tr>`).join(''); return `<div class="card"><h3>${title}</h3><div class="table-container"><table><thead><tr><th>Player</th><th>Team</th><th>${th1}</th><th>${th2}</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div></div>`; }
function initializeCareerAnalysisTab() {
    const controls = document.getElementById("career-controls");
    controls?.addEventListener('change', renderCareerChart);
    controls?.querySelector('#career-search-player').addEventListener('input', renderCareerChart);
    renderCareerChart();
}
async function renderCareerChart() {
    const chartWrapper = document.getElementById("career-chart-wrapper"); if (careerChartInstance) careerChartInstance.destroy();
    chartWrapper.innerHTML = '<canvas id="career-chart"></canvas>'; const ctx = document.getElementById('career-chart')?.getContext('2d'); if (!ctx) return;
    const careerData = await fetchSeasonData('career_data');
    if (!careerData || !careerData.players) { chartWrapper.innerHTML = `<p class="error-cell" style="text-align:center; padding: 20px;">Career analysis data not available.</p>`; return; }
    const stat = document.getElementById("career-stat-selector").value; const xAxis = document.getElementById("career-xaxis-selector").value; const searchTerm = document.getElementById("career-search-player").value.toLowerCase().trim(); const draftFilter = document.getElementById("career-draft-filter").value; const minutesFilter = document.getElementById("career-minutes-filter").value; const showAverages = document.getElementById("career-averages-toggle").checked;
    let highlightedPlayerId = null; if (searchTerm) { const entry = Object.entries(fullData.playerProfiles).find(([id, profile]) => profile?.playerName?.toLowerCase().includes(searchTerm)); if (entry) highlightedPlayerId = parseInt(entry[0], 10); }
    let playerIdsToDisplay = Object.keys(careerData.players);
    if (draftFilter !== 'All') { playerIdsToDisplay = playerIdsToDisplay.filter(id => fullData.playerProfiles[id]?.draftCategory === draftFilter); }
    if (minutesFilter === '15_career') { playerIdsToDisplay = playerIdsToDisplay.filter(id => fullData.playerProfiles[id]?.careerAvgMpg > 15); }
    const datasets = []; const minDraftYear = 1997; const maxDraftYear = new Date().getFullYear();
    playerIdsToDisplay.forEach(id => {
        let playerData = careerData.players[id];
        if (minutesFilter === '15_game') { playerData = playerData.filter(d => d.MIN >= 15); }
        if (playerData.length === 0) return;
        const draftYear = fullData.playerProfiles[id]?.draft_year || minDraftYear; const yearRatio = (draftYear - minDraftYear) / (maxDraftYear - minDraftYear); const opacity = 0.08 + (yearRatio * 0.27);
        datasets.push({ label: `Player ${id}`, data: playerData.map(d => ({ x: d[xAxis], y: d[stat] })), borderColor: `rgba(128, 128, 128, ${opacity})`, borderWidth: 1.5, pointRadius: 0, tension: 0.1 });
    });
    if (highlightedPlayerId && playerIdsToDisplay.includes(String(highlightedPlayerId))) {
        let highlightedData = careerData.players[String(highlightedPlayerId)]; if (minutesFilter === '15_game') { highlightedData = highlightedData.filter(d => d.MIN >= 15); }
        if (highlightedData.length > 0) { datasets.push({ label: fullData.playerProfiles[highlightedPlayerId].playerName, data: highlightedData.map(d => ({ x: d[xAxis], y: d[stat] })), borderColor: 'var(--text-primary)', borderWidth: 2.5, pointRadius: 0, order: -10 }); }
    }
    if (showAverages) {
        const averageColors = { G: '#2980b9', F: '#27ae60', C: '#c0392b', Draft: '#8e44ad' };
        if (careerData.by_position) { ['G', 'F', 'C'].forEach(pos => { if(careerData.by_position[pos]) { datasets.push({ label: `Avg. ${pos}`, data: careerData.by_position[pos].map(d => ({ x: d[xAxis], y: d[stat] })), borderColor: averageColors[pos], borderWidth: 2, borderDash: [5, 5], pointRadius: 0, order: -5 }); } }); }
        if (draftFilter !== 'All' && careerData.by_draft_category?.[draftFilter]) { datasets.push({ label: `Avg. ${draftFilter}`, data: careerData.by_draft_category[draftFilter].map(d => ({ x: d[xAxis], y: d[stat] })), borderColor: averageColors.Draft, borderWidth: 2.5, pointRadius: 0, order: -6 }); }
    }
    careerChartInstance = new Chart(ctx, { type: 'line', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 500 }, plugins: { legend: { labels: { color: 'var(--text-primary)', filter: item => item.label && !item.label.startsWith('Player ') } }, decimation: { enabled: true, algorithm: 'lttb', samples: 200 } }, scales: { x: { type: 'linear', title: { display: true, text: xAxis === 'age' ? 'Player Age' : 'WNBA Games Played', color: 'var(--text-secondary)'}, ticks: {color: 'var(--text-secondary)'} }, y: { title: { display: true, text: `Monthly Average ${stat}`, color: 'var(--text-secondary)' }, ticks: {color: 'var(--text-secondary)'} } } } });
}
