// script.js (v41.0 - FINAL: Charting Engine Overhaul & Full Functionality Restoration)

// --- GLOBAL STATE & CONFIGURATION ---
let fullData = { modelNames: [] };
let loadedSeasonDataCache = {};
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

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
    initializeTheme();
    try {
        const response = await fetch("dist/predictions.json");
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
        initializeCareerAnalysisTab();

        document.body.addEventListener('click', handleGlobalClicks);
        document.querySelector('.tab-link').click();

    } catch (e) {
        console.error("FATAL: Failed to initialize application.", e);
        document.body.innerHTML = `<div style="text-align:center; padding: 50px; font-size:1.2em;">Error: Could not load core application data (predictions.json). Please check the file path and browser console for details.<br><br><i>${e.message}</i></div>`;
    }
});

function initializeTheme() { /* Unchanged */ }
function openTab(evt, tabName) { /* Unchanged */ }

async function fetchSeasonData(key) {
    if (!key) return null;
    if (loadedSeasonDataCache[key]) return loadedSeasonDataCache[key];
    try {
        const response = await fetch(`dist/data/${key}.json`);
        if (!response.ok) throw new Error(`File not found for key: ${key}`);
        const data = await response.json();
        loadedSeasonDataCache[key] = data;
        return data;
    } catch (e) { console.error(`Error fetching ${key}.json`, e); return null; }
}

function handleGlobalClicks(e) { /* Unchanged */ }

// --- PLAYER PROFILE OVERLAY (RE-ARCHITECTED) ---
async function showPlayerProfileOverlay(profile) {
    const overlay = document.getElementById("player-profile-overlay");
    overlay.innerHTML = buildPlayerProfileModalHTML(profile);

    const renderContent = async () => {
        const chartContainer = document.getElementById('modal-chart-container');
        const careerCurveToggle = overlay.querySelector('#career-curve-toggle-checkbox').checked;
        if (careerCurveToggle) {
            await renderPlayerCareerCurveChart(profile, chartContainer);
        } else {
            await renderPlayerPerformanceHistoryChart(profile, chartContainer);
        }
    };
    
    // Attach event listeners to the new modal structure
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
    
    // Create cleaner model toggles for the performance chart
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
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    // Show controls relevant to this chart
    document.querySelector('.modal-model-toggles').style.display = 'block';
    document.querySelector('.reset-zoom-btn').style.display = 'block';
    document.querySelector('.profile-main-header h3').textContent = `Performance & Projections: ${MODAL_CHART_STATS[statKey]}`;

    const datasets = [];
    
    // 1. Process Actual Performance History
    const history = profile.performanceHistory || [];
    if (history.length > 0) {
        const actualData = history.map(d => ({ x: d.game_number, y: d[statKey] })).filter(d => d.y != null);
        if (actualData.length > 0) {
            datasets.push({ 
                label: 'Actual', data: actualData, 
                borderColor: 'var(--text-primary)', backgroundColor: 'var(--text-primary)',
                type: 'line', tension: 0.1, borderWidth: 3, pointRadius: 0, order: 10 // Render on top
            });
        }
    }

    // 2. Process Future Projections from all models
    const projections = profile.futureProjections || [];
    if (projections.length > 0) {
        fullData.modelNames.forEach(modelName => {
            const modelData = projections
                .filter(p => p.model_source === modelName && p[statKey] != null)
                .map(p => ({ x: p.game_number, y: p[statKey] }));
            
            if (modelData.length > 0) {
                datasets.push({
                    label: modelName, data: modelData,
                    borderColor: MODEL_COLORS[modelName] || MODEL_COLORS['Default'],
                    backgroundColor: MODEL_COLORS[modelName] || MODEL_COLORS['Default'],
                    borderWidth: 2, pointRadius: 0, borderDash: [5, 5],
                    hidden: !document.querySelector(`.modal-model-toggle[data-model="${modelName}"]`)?.checked
                });
            }
        });
    }

    if (datasets.length === 0) {
        container.innerHTML = '<div class="statline-placeholder"><p>No performance or projection data available for this player.</p></div>';
        return;
    }

    modalChartInstance = new Chart(ctx, {
        type: 'line', data: { datasets },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            scales: { 
                x: { type: 'linear', title: { display: true, text: 'WNBA Games Played' } }, 
                y: { beginAtZero: true, title: { display: true, text: MODAL_CHART_STATS[statKey] } } 
            }, 
            plugins: { 
                legend: { position: 'bottom' }, 
                tooltip: { mode: 'index', intersect: false },
                zoom: { 
                    pan: { enabled: true, mode: 'x' }, 
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } 
                }
            }, 
            interaction: { mode: 'nearest', axis: 'x', intersect: false } 
        }
    });
}

async function renderPlayerCareerCurveChart(profile, container) {
    const statKey = document.getElementById('modal-stat-selector')?.value || 'PTS';
    if (modalChartInstance) modalChartInstance.destroy();
    
    const canvas = container.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    // Hide controls irrelevant to this chart
    document.querySelector('.modal-model-toggles').style.display = 'none';
    document.querySelector('.reset-zoom-btn').style.display = 'none';
    document.querySelector('.profile-main-header h3').textContent = `Career Curve (3-Month Rolling Avg): ${MODAL_CHART_STATS[statKey]}`;

    const careerData = await fetchSeasonData('career_data');
    const playerData = careerData?.players?.[String(profile.personId)];
    
    if (!playerData || playerData.length === 0) {
        container.innerHTML = '<div class="statline-placeholder"><p>No long-term career data available for this player.</p></div>';
        return;
    }

    const datasets = [{
        label: `Rolling Avg. ${statKey}`,
        data: [],
        borderColor: 'var(--primary-color)',
        tension: 0.1,
        spanGaps: false // Creates breaks in the line for null data points
    }];

    const sortedData = playerData.map(d => ({...d, dateObj: new Date(d.date)})).sort((a,b) => a.dateObj - b.dateObj);

    for (let i = 0; i < sortedData.length; i++) {
        const point = sortedData[i];
        if(i > 0) {
            const prevPoint = sortedData[i-1];
            const daysDiff = (point.dateObj - prevPoint.dateObj) / (1000 * 60 * 60 * 24);
            if(daysDiff > 100) { // Off-season break
                datasets[0].data.push({x: prevPoint.dateObj.valueOf() + (1000*60*60*24), y: null});
            }
        }
        datasets[0].data.push({ x: point.dateObj.valueOf(), y: point[statKey] });
    }
    
    modalChartInstance = new Chart(ctx, {
        type: 'line', data: { datasets },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { display: false } }, 
            scales: { 
                x: { type: 'time', time: { unit: 'year' }, title: { display: true, text: 'Date' } }, 
                y: { title: { display: true, text: `Rolling Avg. ${MODAL_CHART_STATS[statKey]}` } } 
            } 
        }
    });
}


// --- SEASON-LONG & DEPENDENT TABS (UNCHANGED CORE LOGIC, VERIFIED ROBUST) ---
function initializeSeasonTab() { /* Unchanged */ }
function onSeasonControlsChange() { /* Unchanged */ }
async function renderSeasonTable() { /* Unchanged */ }
function handleSortSeason(e) { /* Unchanged */ }
function sortSeasonData() { /* Unchanged */ }
function renderSeasonTableBody(showCount) { /* Unchanged, Python fixes handle the data */ }

// --- DAILY PROJECTIONS TAB (WITH BRANDING & REFINEMENTS) ---
function initializeDailyTab() { /* Unchanged */ }
function setDailyProjectionMode(mode) { /* Unchanged */ }
function updateDailyGamesView() { /* Unchanged */ }
function getActiveProjection(allModelProjections) { /* Unchanged */ }

function renderDailyGamesForDate(date) {
    const container = document.getElementById("daily-games-container");
    const games = fullData.dailyGamesByDate?.[date] || [];
    if (games.length === 0) { container.innerHTML = '<div class="card"><p>No games for this date.</p></div>'; return; }
    const getBadgeClass = pts => pts > 20 ? 'elite' : pts > 15 ? 'very-good' : pts > 10 ? 'good' : 'average';
    
    container.innerHTML = games.map(game => {
        const activeProjection = getActiveProjection(game.projections);
        if (!activeProjection || activeProjection.length < 2) return '';
        const [team1, team2] = activeProjection;

        // **NEW**: Team branding logic
        const homeTeamAbbr = TEAM_ABBR_MAP[team1.teamName] || 'FA';
        const cardStyle = `border-left-color: var(--team-${homeTeamAbbr.toLowerCase()});`;

        let scoreHTML = `Predicted: <strong>${Math.round(team1.totalPoints)} - ${Math.round(team2.totalPoints)}</strong>`;
        if (game.grade?.isGraded) {
            const actualSummary = game.grade.gameSummary.actual;
            const team1Abbr = TEAM_ABBR_MAP[team1.teamName];
            const team2Abbr = TEAM_ABBR_MAP[team2.teamName];
            const actual1 = actualSummary[team1Abbr] || 0;
            const actual2 = actualSummary[team2Abbr] || 0;
            const modelKey = dailyProjectionState.mode === 'single' ? dailyProjectionState.selectedModel : 'Ensemble'; // Simplified for now
            const modelGrade = game.grade.model_grades[modelKey] || Object.values(game.grade.model_grades)[0];
            const correctWinnerClass = modelGrade?.correctWinner ? 'prediction-correct' : 'prediction-incorrect';
            scoreHTML = `Predicted: <strong class="${correctWinnerClass}">${Math.round(team1.totalPoints)} - ${Math.round(team2.totalPoints)}</strong><span class="actual-score">Actual: <strong>${actual1} - ${actual2}</strong></span>`;
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
        if (isGraded) {
            const actuals = gameGrade.playerActuals?.[p.personId];
            predRow = `<tr class="player-row-pred"><td ${actuals ? 'rowspan="2"' : ''} class="player-name-cell">${nameHtml}</td><td class="stat-type-cell">P</td><td>${(p.Predicted_Minutes || 0).toFixed(1)}</td><td>${(p.points || 0).toFixed(1)}</td><td>${(p.reb || 0).toFixed(1)}</td><td>${(p.ast || 0).toFixed(1)}</td></tr>`;
            if (actuals) {
                actualRow = `<tr class="player-row-actual"><td class="stat-type-cell">A</td><td>-</td><td>${(actuals.PTS || 0).toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.points, actuals.PTS)}"></span></td><td>${(actuals.REB || 0).toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.reb, actuals.REB)}"></span></td><td>${(actuals.AST || 0).toFixed(0)}<span class="performance-indicator ${getPerfIndicator(p.ast, actuals.AST)}"></span></td></tr>`;
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
            if (metric === 'dailyWinLoss') {
                const wins = dayGrades.reduce((s, g) => s + (g.correctWinner ? 1 : 0), 0);
                return dayGrades.length > 0 ? (wins / dayGrades.length) * 100 : 0;
            }
            const values = dayGrades.map(g => g[metric]).filter(v => v !== undefined && v !== null && !isNaN(v));
            return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
        }).filter(v => v !== null);
        if (metric === 'cumulativeWinLoss') {
            let wins = 0, total = 0;
            const cumulativeData = sortedDates.map(date => {
                const dayGrades = gradesByDate[date].map(g => g.model_grades[modelName]).filter(Boolean);
                wins += dayGrades.reduce((s, g) => s + (g.correctWinner ? 1 : 0), 0);
                total += dayGrades.length;
                return total > 0 ? (wins / total) * 100 : 0;
            });
            datasets.push({ label: modelName, data: cumulativeData, borderColor: MODEL_COLORS[i % MODEL_COLORS.length], tension: 0.1, fill: false });
        } else {
            datasets.push({ label: modelName, data, backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] });
        }
    });
    let chartConfig;
    const labels = sortedDates.map(d => new Date(d + "T00:00:00").toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    if (metric === 'cumulativeWinLoss') chartConfig = { type: 'line', data: { labels, datasets }, options: { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } } };
    else chartConfig = { type: 'bar', data: { labels, datasets }, options: metric === 'dailyWinLoss' ? { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } } : {} };
    if (accuracyChartInstance) accuracyChartInstance.destroy();
    accuracyChartInstance = new Chart(ctx, { ...chartConfig, options: { ...chartConfig.options, responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
}


// --- TEAM ANALYSIS & PLAYER PROGRESSION TABS ---
async function renderTeamAnalysis() {
    const container = document.getElementById("team-analysis-container");
    container.innerHTML = '<div class="card"><p>Loading team data...</p></div>';
    let sourceKey = document.getElementById("season-source-selector").value;
    if (!sourceKey.endsWith('per_game')) sourceKey = sourceKey.replace(/total$/, 'per_game');
    const data = await fetchSeasonData(sourceKey);
    if (!data) { container.innerHTML = '<div class="card"><p class="error-cell">Could not load team data.</p></div>'; return; }
    const teams = data.reduce((acc, p) => { (acc[p.team || 'FA'] = acc[p.team || 'FA'] || []).push(p); return acc; }, {});
    container.innerHTML = Object.entries(teams).sort((a,b) => (b[1].reduce((s,p)=>s+(p.custom_z_score||0),0)) - (a[1].reduce((s,p)=>s+(p.custom_z_score||0),0))).map(([teamName, players]) => {
        const teamStrength = players.reduce((sum, p) => sum + (p.custom_z_score || 0), 0);
        const playerRows = players.sort((a,b) => (b.custom_z_score || 0) - (a.custom_z_score || 0)).map(p => `<tr><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName}</a></td><td>${(p.GP||0).toFixed(0)}</td><td>${(p.MIN||0).toFixed(1)}</td><td>${(p.PTS||0).toFixed(1)}</td><td>${(p.REB||0).toFixed(1)}</td><td>${(p.AST||0).toFixed(1)}</td><td>${(p.custom_z_score||0).toFixed(2)}</td></tr>`).join('');
        return `<div class="team-card"><div class="team-card-header"><h3>${teamName === 'FA' ? 'Free Agents' : teamName}</h3><div class="team-strength-score">${teamStrength.toFixed(2)}</div></div><div class="table-container"><table><thead><tr><th>Player</th><th>GP</th><th>MPG</th><th>PTS</th><th>REB</th><th>AST</th><th>Z-Score</th></tr></thead><tbody>${playerRows}</tbody></table></div></div>`;
    }).join('');
}

async function renderPlayerProgression() {
    const container = document.getElementById("player-progression-container");
    container.innerHTML = '<div class="card" style="padding:20px; text-align:center;">Loading...</div>';
    let projSourceKey = document.getElementById("season-source-selector").value;
    if(!projSourceKey.includes('projections')) projSourceKey = Object.keys(fullData.seasonLongDataManifest).find(k => k.includes('Ensemble_hybrid_per_game')) || projSourceKey;
    const futureData = await fetchSeasonData(projSourceKey);
    const historicalData = await fetchSeasonData('actuals_2024_full_per_game');
    if (!futureData || !historicalData) { container.innerHTML = '<div class="card"><p class="error-cell">Could not load progression data.</p></div>'; return; }
    const merged = futureData.map(p_future => {
        const p_hist = historicalData.find(p => p.personId === p_future.personId);
        return p_hist ? { ...p_future, z_Total_2024: p_hist.custom_z_score, z_Total_2025_Proj: p_future.custom_z_score, z_Change: (p_future.custom_z_score || 0) - (p_hist.custom_z_score || 0) } : null;
    }).filter(Boolean);
    let html = '';
    html += createProgressionTable('Top Risers (2025 Proj. vs 2024)', [...merged].sort((a,b)=>b.z_Change-a.z_Change).slice(0,15), "'24 Z","'25 Proj. Z", "z_Total_2024", "z_Total_2025_Proj");
    html += createProgressionTable('Top Fallers (2025 Proj. vs 2024)', [...merged].sort((a,b)=>a.z_Change-b.z_Change).slice(0,15), "'24 Z","'25 Proj. Z", "z_Total_2024", "z_Total_2025_Proj");
    container.innerHTML = html;
}

function createProgressionTable(title, players, th1, th2, key1, key2) {
    const rows = players.map(p => `<tr><td><a href="#" class="player-link" data-person-id="${p.personId}">${p.playerName}</a></td><td>${p.team}</td><td>${(p[key1]||0).toFixed(2)}</td><td>${(p[key2]||0).toFixed(2)}</td><td class="${p.z_Change>=0?'text-success':'text-danger'}">${p.z_Change>=0?'+':''}${(p.z_Change||0).toFixed(2)}</td></tr>`).join('');
    return `<div class="card"><h3>${title}</h3><div class="table-container"><table><thead><tr><th>Player</th><th>Team</th><th>${th1}</th><th>${th2}</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// --- CAREER ANALYSIS TAB ---
function initializeCareerAnalysisTab() {
    document.getElementById("career-controls").addEventListener('change', renderCareerChart);
    document.getElementById('career-add-player-btn').addEventListener('click', handleAddCareerPlayer);
    document.getElementById('career-clear-players-btn').addEventListener('click', () => {
        careerChartState.highlightedPlayers.clear();
        renderHighlightedPlayerList();
        renderCareerChart();
    });
    const datalist = document.getElementById('player-datalist');
    datalist.innerHTML = Object.values(fullData.playerProfiles).sort((a,b) => a.playerName.localeCompare(b.playerName)).map(p => `<option value="${p.playerName}"></option>`).join('');
    document.querySelector('.tab-link[onclick*="CareerAnalysis"]').addEventListener('click', renderCareerChart, { once: true });
}

function handleAddCareerPlayer() {
    const input = document.getElementById('career-search-player');
    const player = Object.values(fullData.playerProfiles).find(p => p.playerName.toLowerCase() === input.value.toLowerCase());
    if (player && !careerChartState.highlightedPlayers.has(player.personId)) {
        const color = MODEL_COLORS[careerChartState.highlightedPlayers.size % MODEL_COLORS.length];
        careerChartState.highlightedPlayers.set(player.personId, { name: player.playerName, color: color });
        renderHighlightedPlayerList();
        renderCareerChart();
        input.value = '';
    }
}

function renderHighlightedPlayerList() {
    const container = document.getElementById('career-highlighted-players');
    container.innerHTML = Array.from(careerChartState.highlightedPlayers.values()).map(p => 
        `<span class="guide-item" style="background-color: ${p.color}; color: var(--text-on-dark-bg);">${p.name}</span>`
    ).join('');
}

async function renderCareerChart() {
    if (careerChartInstance) careerChartInstance.destroy();
    const ctx = document.getElementById('career-chart')?.getContext('2d');
    if (!ctx) return;
    
    const careerData = await fetchSeasonData('career_data');
    if (!careerData || Object.keys(careerData.players).length === 0) {
        document.getElementById("career-chart-wrapper").innerHTML = `<p class="statline-placeholder">Career analysis data not available or is empty.</p>`;
        return;
    }
    
    const stat = document.getElementById("career-stat-selector").value;
    const xAxis = document.getElementById("career-xaxis-selector").value;
    const draftFilter = document.getElementById("career-draft-filter").value;
    const minutesFilter = document.getElementById("career-minutes-filter").value;
    const showAverages = document.getElementById("career-averages-toggle").checked;
    const colorByTeam = document.getElementById("career-color-by-team-toggle").checked;

    let playerIdsToDisplay = Object.keys(careerData.players).map(id => parseInt(id, 10));
    if (draftFilter !== 'All') playerIdsToDisplay = playerIdsToDisplay.filter(id => fullData.playerProfiles[id]?.draftCategory === draftFilter);
    if (minutesFilter === '15_career') playerIdsToDisplay = playerIdsToDisplay.filter(id => (fullData.playerProfiles[id]?.careerAvgMpg || 0) > 15);

    const datasets = [];
    playerIdsToDisplay.forEach(id => {
        if (careerChartState.highlightedPlayers.has(id)) return;
        let playerData = careerData.players[String(id)];
        if (!playerData) return;
        if (minutesFilter === '15_game') playerData = playerData.filter(d => d.MIN >= 15);
        
        const playerProfile = fullData.playerProfiles[id];
        const borderColor = colorByTeam ? (TEAM_COLORS[playerProfile?.team] || TEAM_COLORS.FA) : 'rgba(128, 128, 128, 0.2)';

        if (playerData.length > 0) datasets.push({ label: `Player ${id}`, data: playerData.map(d => ({ x: d[xAxis], y: d[stat] })).filter(d=>d.x != null && d.y != null), borderColor, borderWidth: 1.5, pointRadius: 0, tension: 0.1 });
    });

    for (const [id, playerInfo] of careerChartState.highlightedPlayers.entries()) {
        let highlightedData = careerData.players[String(id)];
        if (highlightedData) {
            if (minutesFilter === '15_game') highlightedData = highlightedData.filter(d => d.MIN >= 15);
            if (highlightedData.length > 0) datasets.push({ label: playerInfo.name, data: highlightedData.map(d => ({ x: d[xAxis], y: d[stat] })).filter(d=>d.x != null && d.y != null), borderColor: playerInfo.color, borderWidth: 3, pointRadius: 0, tension: 0.1, order: -10 });
        }
    }

    if (showAverages) {
        const averageColors = { G: '#2980b9', F: '#27ae60', C: '#c0392b', Draft: '#8e44ad' };
        const positionData = careerData[`by_position_${xAxis}`];
        const draftData = careerData[`by_draft_category_${xAxis}`];
        if (positionData) Object.entries(positionData).forEach(([pos, data]) => {
            if (['G', 'F', 'C'].includes(pos)) datasets.push({ label: `Avg. ${pos}`, data: data.map(d => ({ x: d[xAxis], y: d[stat] })).filter(d=>d.x != null && d.y != null), borderColor: averageColors[pos] || '#7f8c8d', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, order: -5 });
        });
        if (draftFilter !== 'All' && draftData?.[draftFilter]) datasets.push({ label: `Avg. ${draftFilter}`, data: draftData[draftFilter].map(d => ({ x: d[xAxis], y: d[stat] })).filter(d=>d.x != null && d.y != null), borderColor: averageColors.Draft, borderWidth: 2.5, pointRadius: 0, order: -6 });
    }
    
    careerChartInstance = new Chart(ctx, { type: 'line', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: 'var(--text-primary)', filter: item => !item.label.startsWith('Player ') } }, decimation: { enabled: true, algorithm: 'lttb', samples: colorByTeam ? 500 : 200 } }, scales: { x: { type: 'linear', title: { display: true, text: xAxis === 'age' ? 'Player Age' : 'WNBA Games Played' } }, y: { title: { display: true, text: `Rolling 3-Month Average ${stat}` } } } } });
}
