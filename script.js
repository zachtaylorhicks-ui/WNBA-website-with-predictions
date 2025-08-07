import pandas as pd
import numpy as np
import json
import os
from datetime import datetime
import gspread
from google.colab import auth
from google.auth import default
import logging
import warnings
import requests
from bs4 import BeautifulSoup
import re
import time
import unicodedata
import zipfile
import shutil
import random

# Install fuzzywuzzy for robust name matching
try:
    from fuzzywuzzy import process, fuzz
except ImportError:
    print("Installing fuzzywuzzy...")
    import subprocess
    import sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fuzzywuzzy", "python-Levenshtein", "--quiet"])
    from fuzzywuzzy import process, fuzz
    print("Installation complete.")

# --- CONFIGURATION ---
pd.options.mode.chained_assignment = None
warnings.simplefilter(action='ignore', category=FutureWarning)
SHEET_NAME = "WNBA Season Predictions"; WORKSHEET_NAME = "All_Models_Data"
DIST_DIR = 'dist'; DATA_DIR = os.path.join(DIST_DIR, 'data')
HISTORICAL_DATA_FILE = 'wnba_model_ready_data.csv'
WIKI_CACHE_FILE = 'wnba_wiki_cache.json'
FORCE_WIKI_RESCRAPE = True

PROJECTION_YEAR = 2025; LAST_HISTORICAL_YEAR = PROJECTION_YEAR - 1
ROOKIE_MINUTES_PLACEHOLDER = 18.0
FANTASY_STATS_COUNTING = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TOV']
FANTASY_STATS_PERCENTAGE = ['FG_impact', 'FT_impact']; ALL_FANTASY_STATS = FANTASY_STATS_COUNTING + FANTASY_STATS_PERCENTAGE

WNBA_ROSTER_URL = "https://en.wikipedia.org/wiki/List_of_current_WNBA_team_rosters"
WNBA_ALL_PLAYERS_URL = "https://en.wikipedia.org/wiki/List_of_Women%27s_National_Basketball_Association_players"
WNBA_TEAM_NAME_MAP = {
    "Atlanta Dream": "ATL", "Chicago Sky": "CHI", "Connecticut Sun": "CON", "Dallas Wings": "DAL", "Indiana Fever": "IND", "Las Vegas Aces": "LVA", "Los Angeles Sparks": "LAS", "Minnesota Lynx": "MIN", "New York Liberty": "NYL", "Phoenix Mercury": "PHO", "Seattle Storm": "SEA", "Washington Mystics": "WAS", "Golden State Valkyries": "GSV", 'Atlanta': 'ATL', 'Chicago': 'CHI', 'Connecticut': 'CON', 'Dallas': 'DAL', 'Indiana': 'IND', 'Las Vegas': 'LVA', 'Los Angeles': 'LAS', 'Minnesota': 'MIN', 'New York': 'NYL', 'Phoenix': 'PHO', 'Seattle': 'SEA', 'Washington': 'WAS', 'Golden State': 'GSV', 'Golden State Va': 'GSV', 'CONN': 'CON', 'LV': 'LVA', 'LA': 'LAS', 'NY': 'NYL', 'PHX': 'PHO', 'WSH':'WAS', 'GS':'GSV'
}
REVERSE_TEAM_MAP = {v: k for k, v in {'ATL': 'Atlanta Dream', 'CHI': 'Chicago Sky', 'CON': 'Connecticut Sun', 'DAL': 'Dallas Wings', 'IND': 'Indiana Fever', 'LVA': 'Las Vegas Aces', 'LAS': 'Los Angeles Sparks', 'MIN': 'Minnesota Lynx', 'NYL': 'New York Liberty', 'PHO': 'Phoenix Mercury', 'SEA': 'Seattle Storm', 'WAS': 'Washington Mystics', 'GSV': 'Golden State Valkyries'}.items()}

PLAYER_ID_NAME_MAP, NORMALIZED_NAME_TO_ID_MAP, NORMALIZED_CANONICAL_NAMES = {}, {}, []
PROJECTION_STAT_MAP = {'ensembled_points': 'PTS', 'ensembled_reboundsTotal': 'REB', 'ensembled_assists': 'AST', 'ensembled_steals': 'STL', 'ensembled_blocks': 'BLK', 'ensembled_threePointersMade': '3PM', 'ensembled_turnovers': 'TOV', 'ensembled_fieldGoalsMade': 'FGM', 'ensembled_fieldGoalsAttempted': 'FGA', 'ensembled_freeThrowsMade': 'FTM', 'ensembled_freeThrowsAttempted': 'FTA', 'player_id': 'personId', 'player_name': 'playerName', 'team_name': 'team'}
HISTORICAL_STAT_MAP = {'points': 'PTS', 'reboundsTotal': 'REB', 'assists': 'AST', 'steals': 'STL', 'blocks': 'BLK', 'threePointersMade': '3PM', 'turnovers': 'TOV', 'fieldGoalsMade': 'FGM', 'fieldGoalsAttempted': 'FGA', 'freeThrowsMade': 'FTM', 'freeThrowsAttempted': 'FTA', 'personId': 'personId', 'fullName': 'playerName', 'playerteamName': 'playerteamName', 'opponentteamName':'opponentteamName', 'numMinutes': 'MIN', 'win': 'win', 'home': 'home'}

def setup_environment():
    if os.path.exists(DIST_DIR): shutil.rmtree(DIST_DIR)
    os.makedirs(DATA_DIR, exist_ok=True); logging.info(f"Output directories cleaned and ready.")
def authenticate_and_load_sheet():
    try:
        logging.info("Authenticating with Google..."); auth.authenticate_user(); creds, _ = default(); gc = gspread.authorize(creds)
        worksheet = gc.open(SHEET_NAME).worksheet(WORKSHEET_NAME); data = worksheet.get_all_records(default_blank=np.nan); df = pd.DataFrame(data)
        logging.info(f"Successfully loaded {len(df)} rows from Google Sheet."); return df
    except Exception as e: logging.error(f"Failed to load Google Sheet: {e}"); return pd.DataFrame()
def sanitize_for_json(obj):
    if isinstance(obj, dict): return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list): return [sanitize_for_json(elem) for elem in obj]
    elif pd.isna(obj) or (isinstance(obj, (np.floating, float)) and (np.isnan(obj) or np.isinf(obj))): return None
    if isinstance(obj, np.integer): return int(obj)
    if isinstance(obj, np.floating): return float(obj)
    return obj
def normalize_name(name):
    if not isinstance(name, str): return ""
    return "".join(c for c in unicodedata.normalize('NFKD', name.lower()) if not unicodedata.combining(c))
def get_player_id_from_name(name, threshold=90):
    normalized_name = normalize_name(name)
    if normalized_name in NORMALIZED_NAME_TO_ID_MAP: return NORMALIZED_NAME_TO_ID_MAP[normalized_name]
    match, score = process.extractOne(normalized_name, NORMALIZED_CANONICAL_NAMES, scorer=fuzz.token_set_ratio)
    return NORMALIZED_NAME_TO_ID_MAP.get(match) if match and score >= threshold else None
def get_team_abbr(team_name_str):
    if not isinstance(team_name_str, str): return None
    team_name_str = team_name_str.strip()
    for keyword, abbr in WNBA_TEAM_NAME_MAP.items():
        if keyword in team_name_str: return abbr
    return None
def build_player_universe(hist_df, proj_df):
    global PLAYER_ID_NAME_MAP, NORMALIZED_NAME_TO_ID_MAP, NORMALIZED_CANONICAL_NAMES
    hist_players = hist_df[['personId', 'firstName', 'lastName']].dropna().drop_duplicates(subset='personId')
    hist_players['playerName'] = hist_players['firstName'] + ' ' + hist_players['lastName']
    proj_players = proj_df[['player_id', 'player_name']].dropna().rename(columns={'player_id': 'personId', 'player_name': 'playerName'})
    all_players_df = pd.concat([hist_players[['personId', 'playerName']], proj_players], ignore_index=True).drop_duplicates(subset='personId')
    all_players_df['personId'] = pd.to_numeric(all_players_df['personId'], errors='coerce').dropna().astype(int)
    for _, row in all_players_df.iterrows():
        pid, name = row['personId'], row['playerName']
        if pd.notna(pid) and pd.notna(name):
            pid_int = int(pid); PLAYER_ID_NAME_MAP[pid_int] = name
            norm_name = normalize_name(str(name))
            if norm_name not in NORMALIZED_NAME_TO_ID_MAP: NORMALIZED_NAME_TO_ID_MAP[norm_name] = pid_int
    NORMALIZED_CANONICAL_NAMES = list(NORMALIZED_NAME_TO_ID_MAP.keys())
    logging.info(f"Player universe built with {len(PLAYER_ID_NAME_MAP)} players.")
def standardize_position(pos_string):
    if not isinstance(pos_string, str): return 'N/A'
    pos_map = {'Guard': 'G', 'Forward': 'F', 'Center': 'C', 'Point guard': 'PG', 'Shooting guard': 'SG', 'Small forward': 'SF', 'Power forward': 'PF'}
    for long, short in pos_map.items(): pos_string = pos_string.replace(long, short)
    return '/'.join(sorted(list(set(re.findall(r'PG|SG|SF|PF|G|F|C', pos_string))))) or 'N/A'
def standardize_draft(draft_string):
    if not isinstance(draft_string, str): return 'N/A'
    if 'undrafted' in draft_string.lower(): return 'Undrafted'
    pattern = r'(\d{4}).*?(\d+).*?round.*?(\d+).*?pick'
    match = re.search(pattern, draft_string, re.IGNORECASE)
    if match:
        year, round_num, pick_num = match.groups(); return f"{year} / R{round_num} / P{pick_num}"
    return 'N/A'

def enrich_player_profiles(player_profiles):
    logging.info(f"--- Enriching {len(player_profiles)} player profiles with infobox details ---")
    log_sample = random.sample(list(player_profiles.keys()), min(5, len(player_profiles)))
    for i, (pid, profile) in enumerate(player_profiles.items()):
        if 'wikiUrl' not in profile or not profile['wikiUrl']: continue
        try:
            time.sleep(0.05); response = requests.get(profile['wikiUrl'], headers={'User-Agent': 'Mozilla/5.0'}); response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser'); infobox = soup.find('table', class_='infobox')
            if not infobox:
                profile.setdefault('position', 'N/A')
                profile.setdefault('height', 'N/A'); profile.setdefault('weight', 'N/A'); profile.setdefault('born', 'N/A')
                profile.setdefault('birth_year', None); profile.setdefault('draftInfo', 'N/A'); profile.setdefault('draft_year', None)
                continue

            def get_info(label_regex):
                header = infobox.find('th', string=re.compile(label_regex, re.I))
                return header.find_next_sibling('td').get_text(strip=True, separator=' ') if header and header.find_next_sibling('td') else 'N/A'
            
            infobox_pos_text = get_info(r'(Listed )?Position')
            standardized_infobox_pos = standardize_position(infobox_pos_text)
            if standardized_infobox_pos != 'N/A':
                profile['position'] = standardized_infobox_pos
            else:
                profile.setdefault('position', 'N/A')

            profile['height'] = get_info(r'Listed height')
            profile['weight'] = get_info(r'Listed weight')
            profile['born'] = get_info(r'Born')
            birth_year_match = re.search(r'\((\d{4})-\d{2}-\d{2}\)', profile['born']) or re.search(r'(\d{4})', profile['born'])
            profile['birth_year'] = int(birth_year_match.group(1)) if birth_year_match else None
            profile['draftInfo'] = standardize_draft(get_info(r'WNBA draft'))
            draft_year_match = re.search(r'(\d{4})', profile['draftInfo'])
            profile['draft_year'] = int(draft_year_match.group(1)) if draft_year_match else None
            if pid in log_sample: logging.info(f"  [Sample Log] Enriched {profile.get('playerName', pid)}: Pos={profile['position']}, Draft='{profile['draftInfo']}', Birth Year={profile['birth_year']}")
        except requests.exceptions.HTTPError as e:
            logging.warning(f"  - HTTP Error for {profile.get('playerName', pid)} ({profile['wikiUrl']}): {e}")
            profile.setdefault('position', 'N/A'); profile.setdefault('height', 'N/A'); profile.setdefault('weight', 'N/A')
            profile.setdefault('born', 'N/A'); profile.setdefault('birth_year', None); profile.setdefault('draftInfo', 'N/A')
            profile.setdefault('draft_year', None)
        except Exception as e:
            logging.warning(f"  - Could not enrich profile for {profile.get('playerName', pid)}: {e}")
            profile.setdefault('position', 'N/A'); profile.setdefault('height', 'N/A'); profile.setdefault('weight', 'N/A')
            profile.setdefault('born', 'N/A'); profile.setdefault('birth_year', None); profile.setdefault('draftInfo', 'N/A')
            profile.setdefault('draft_year', None)
    return player_profiles

def hybrid_scraper():
    if not FORCE_WIKI_RESCRAPE and os.path.exists(WIKI_CACHE_FILE):
        logging.info(f"Loading player profiles from cache: {WIKI_CACHE_FILE}");
        with open(WIKI_CACHE_FILE, 'r') as f: return {int(k): v for k, v in json.load(f).items()}
    logging.info("--- Stage 1: Scraping CURRENT ROSTERS for team assignments ---")
    active_player_profiles = {}
    try:
        response = requests.get(WNBA_ROSTER_URL, headers={'User-Agent': 'Mozilla/5.0'}); response.raise_for_status()
        soup = BeautifulSoup(response.content, 'lxml')
        for container in soup.find_all('table', class_='toccolours'):
            team_header = container.find('th'); team_abbreviation = get_team_abbr(team_header.get_text(strip=True)) if team_header else None
            if not team_abbreviation: continue
            player_table = container.find('table', class_='sortable') or container
            for player_row in player_table.select('tr:has(td)'):
                cells = player_row.find_all('td');
                if len(cells) < 4: continue
                position_text = cells[0].get_text(strip=True)
                standardized_pos = standardize_position(position_text)
                player_name = cells[3].get_text(strip=True); link_tag = cells[3].find('a')
                if not player_name or not link_tag or not link_tag.has_attr('href'): continue
                pid = get_player_id_from_name(player_name, threshold=88)
                if pid:
                    active_player_profiles[pid] = { 'personId': pid, 'playerName': PLAYER_ID_NAME_MAP.get(pid, player_name), 'team': team_abbreviation, 'wikiUrl': f"https://en.wikipedia.org{link_tag['href']}", 'position': standardized_pos }
    except Exception as e: logging.error(f"FATAL: Could not process current roster URL: {e}")
    logging.info(f"Found {len(active_player_profiles)} active players with team assignments.")
    logging.info("--- Stage 2: Scraping ALL PLAYERS list for historical context ---")
    historical_player_profiles = {}
    try:
        response = requests.get(WNBA_ALL_PLAYERS_URL, headers={'User-Agent': 'Mozilla/5.0'}); response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser'); content_div = soup.find('div', class_='mw-parser-output')
        for ul_tag in content_div.find_all('ul'):
            for li_tag in ul_tag.find_all('li'):
                all_links = li_tag.find_all('a');
                if not all_links: continue
                link_tag = all_links[-1]
                if link_tag.has_attr('href') and not link_tag['href'].startswith('/wiki/File:'):
                    player_name = link_tag.get_text(strip=True)
                    pid = get_player_id_from_name(player_name, threshold=95)
                    if pid:
                        historical_player_profiles[pid] = { 'personId': pid, 'playerName': PLAYER_ID_NAME_MAP.get(pid, player_name), 'team': 'FA', 'wikiUrl': f"https://en.wikipedia.org{link_tag['href']}" }
    except Exception as e: logging.error(f"FATAL: Could not process all-players URL: {e}")
    logging.info(f"Found {len(historical_player_profiles)} total players from historical list.")
    final_profiles_to_enrich = {**historical_player_profiles, **active_player_profiles}
    logging.info(f"Merged lists. Total unique players to enrich: {len(final_profiles_to_enrich)}")
    final_profiles = enrich_player_profiles(final_profiles_to_enrich)
    with open(WIKI_CACHE_FILE, 'w') as f: json.dump(final_profiles, f, indent=2)
    logging.info(f"Saving {len(final_profiles)} final profiles to cache: {WIKI_CACHE_FILE}")
    return final_profiles

def calculate_z_scores(df_per_game):
    if df_per_game.empty: return df_per_game
    df = df_per_game.copy(); league_avg_fga = df['FGA'].mean(); league_avg_fta = df['FTA'].mean()
    league_avg_fg_pct = df['FGM'].sum() / df['FGA'].sum() if df['FGA'].sum() > 0 else 0; league_avg_ft_pct = df['FTM'].sum() / df['FTA'].sum() if df['FTA'].sum() > 0 else 0
    for stat in FANTASY_STATS_COUNTING:
        mean, std = df[stat].mean(), df[stat].std(); multiplier = -1 if stat == 'TOV' else 1
        df[f'z_{stat}'] = ((df[stat] - mean) / (std if std != 0 else 1)) * multiplier
    df['FG_pct'] = df['FGM'] / df['FGA'].replace(0, 1); df['FT_pct'] = df['FTM'] / df['FTA'].replace(0, 1)
    fg_impact = (df['FG_pct'] - league_avg_fg_pct) * (df['FGA'] / (league_avg_fga if league_avg_fga > 0 else 1)); ft_impact = (df['FT_pct'] - league_avg_ft_pct) * (df['FTA'] / (league_avg_fta if league_avg_fta > 0 else 1))
    df['z_FG_impact'] = (fg_impact - fg_impact.mean()) / (fg_impact.std() if fg_impact.std() != 0 else 1); df['z_FT_impact'] = (ft_impact - ft_impact.mean()) / (ft_impact.std() if ft_impact.std() != 0 else 1)
    df['custom_z_score'] = df[[f'z_{stat}' for stat in ALL_FANTASY_STATS]].sum(axis=1)
    return df
def process_projections(df_proj_raw, historical_minutes_map, master_player_df):
    logging.info("Processing daily predictions to create season-long aggregates..."); df = df_proj_raw[list(PROJECTION_STAT_MAP.keys())].rename(columns=PROJECTION_STAT_MAP); stat_cols = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TOV', 'FGM', 'FGA', 'FTM', 'FTA']
    for col in stat_cols + ['personId']: df[col] = pd.to_numeric(df[col], errors='coerce')
    df.dropna(subset=['personId'], inplace=True); df['personId'] = df['personId'].astype(int)
    player_info = df.groupby('personId').agg(playerName_proj=('playerName', 'first'), team_proj=('team', 'first'), GP=('personId', 'count')).reset_index()
    df_total_stats = df.groupby('personId')[stat_cols].sum().reset_index()
    df_total = pd.merge(player_info, df_total_stats, on='personId')
    df_per_game = df_total.copy()
    for col in stat_cols: df_per_game[col] = df_per_game[col] / df_per_game['GP'].replace(0,1)
    df_per_game['MIN'] = df_per_game['personId'].map(historical_minutes_map).fillna(ROOKIE_MINUTES_PLACEHOLDER)
    df_per_game = pd.merge(df_per_game, master_player_df[['personId', 'playerName', 'team', 'position']], on='personId', how='left')
    df_per_game['team'].fillna(df_per_game['team_proj'].apply(get_team_abbr), inplace=True); df_per_game['playerName'].fillna(df_per_game['playerName_proj'], inplace=True)
    df_total = pd.merge(df_total, master_player_df[['personId', 'playerName', 'position', 'team']], on='personId', how='left')
    df_total['team'].fillna(df_total['team_proj'].apply(get_team_abbr), inplace=True); df_total['playerName'].fillna(df_total['playerName_proj'], inplace=True)
    df_per_game.drop(columns=['team_proj', 'playerName_proj'], inplace=True, errors='ignore'); df_total.drop(columns=['team_proj', 'playerName_proj'], inplace=True, errors='ignore')
    logging.info(f"Aggregated daily predictions for {len(df_per_game)} players."); return df_per_game, df_total
def process_historical_data(df_hist_raw, master_player_df):
    logging.info("Processing historical data..."); df = df_hist_raw.copy(); df['gameDate'] = pd.to_datetime(df['gameDate'])
    df['YEAR'] = df['gameDate'].dt.year; df['fullName'] = df['firstName'].fillna('') + ' ' + df['lastName'].fillna(''); df = df.rename(columns=HISTORICAL_STAT_MAP)
    stat_cols = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TOV', 'FGM', 'FGA', 'FTM', 'FTA', 'MIN']
    all_season_data = {}
    for year in sorted(df['YEAR'].unique(), reverse=True):
        season_df = df[df['YEAR'] == year]; player_gp = season_df.groupby('personId')['gameId'].nunique().reset_index(name='GP'); df_total_stats = season_df.groupby('personId')[stat_cols].sum().reset_index()
        last_game_team = season_df.sort_values('gameDate').groupby('personId')['playerteamName'].last().reset_index().rename(columns={'playerteamName':'team_hist'})
        player_info = season_df.groupby('personId').agg(playerName_hist=('playerName', 'first')).reset_index(); player_info = pd.merge(player_info, last_game_team, on='personId', how='left')
        df_total = pd.merge(player_info, player_gp, on='personId'); df_total = pd.merge(df_total, df_total_stats, on='personId')
        df_total = pd.merge(df_total, master_player_df[['personId', 'playerName', 'position', 'team']], on='personId', how='left')
        df_total['team'].fillna(df_total['team_hist'].apply(get_team_abbr), inplace=True); df_total['playerName'].fillna(df_total['playerName_hist'], inplace=True)
        df_total.drop(columns=['team_hist', 'playerName_hist'], inplace=True, errors='ignore')
        df_per_game = df_total.copy()
        for col in stat_cols: df_per_game[col] = df_per_game[col] / df_per_game['GP'].replace(0,1)
        all_season_data[year] = {'per_game': df_per_game, 'total': df_total}; logging.info(f"Processed historical data for {year} season.")
    return all_season_data
def generate_specialty_files(season_data, proj_data_per_game):
    if LAST_HISTORICAL_YEAR in season_data and not proj_data_per_game.empty:
        df_last_season, df_proj = season_data[LAST_HISTORICAL_YEAR]['per_game_z'], proj_data_per_game
        merged = pd.merge(df_last_season[['personId', 'playerName', 'team', 'custom_z_score']], df_proj[['personId', 'custom_z_score']], on='personId', suffixes=('_last', '_proj'), how='inner')
        if not merged.empty:
            merged['z_Change'] = merged['custom_z_score_proj'] - merged['custom_z_score_last']
            merged = merged.rename(columns={'custom_z_score_last': f'z_Total_{LAST_HISTORICAL_YEAR}', 'custom_z_score_proj': f'z_Total_{PROJECTION_YEAR}_Proj'})
            with open(os.path.join(DATA_DIR, 'progression.json'), 'w') as f: json.dump(sanitize_for_json(merged.to_dict('records')), f, indent=2)
            logging.info("Generated 'progression.json'.")
        else: logging.warning("Progression file generation skipped: No common players between last season and projections.")
def generate_daily_games_and_grades(df_proj_raw, df_hist_raw, historical_minutes_map, master_player_df):
    logging.info("Generating daily games, merging actuals, and grading...");
    df_pred = df_proj_raw.copy().rename(columns=PROJECTION_STAT_MAP); df_pred['game_date'] = pd.to_datetime(df_pred['game_date']).dt.strftime('%Y-%m-%d')
    df_actual = df_hist_raw.copy().rename(columns=HISTORICAL_STAT_MAP); df_actual['gameDate'] = pd.to_datetime(df_actual['gameDate']).dt.strftime('%Y-%m-%d')
    df_actual['personId'] = pd.to_numeric(df_actual['personId'], errors='coerce').dropna().astype(int); df_pred['personId'] = pd.to_numeric(df_pred['personId'], errors='coerce').dropna().astype(int)
    df_pred['home_team_abbr'] = df_pred['home_team'].apply(get_team_abbr); df_pred['away_team_abbr'] = df_pred['away_team'].apply(get_team_abbr)
    df_actual['home_team_abbr'] = np.where(df_actual['home'] == 1, df_actual['playerteamName'].apply(get_team_abbr), df_actual['opponentteamName'].apply(get_team_abbr)); df_actual['away_team_abbr'] = np.where(df_actual['home'] == 0, df_actual['playerteamName'].apply(get_team_abbr), df_actual['opponentteamName'].apply(get_team_abbr))
    df_pred.dropna(subset=['home_team_abbr', 'away_team_abbr'], inplace=True); df_actual.dropna(subset=['home_team_abbr', 'away_team_abbr'], inplace=True)
    df_pred['game_key'] = df_pred['game_date'] + '_' + np.minimum(df_pred['home_team_abbr'], df_pred['away_team_abbr']) + '_' + np.maximum(df_pred['home_team_abbr'], df_pred['away_team_abbr'])
    df_actual['game_key'] = df_actual['gameDate'] + '_' + np.minimum(df_actual['home_team_abbr'], df_actual['away_team_abbr']) + '_' + np.maximum(df_actual['home_team_abbr'], df_actual['away_team_abbr'])
    daily_games, grades, player_perf_hist = {}, [], {}
    for game_key in sorted(df_pred['game_key'].unique()):
        game_pred_df = df_pred[df_pred['game_key'] == game_key]; game_actual_df = df_actual[df_actual['game_key'] == game_key]
        is_graded = not game_actual_df.empty; date, home_abbr, away_abbr = game_pred_df['game_date'].iloc[0], game_pred_df['home_team_abbr'].iloc[0], game_pred_df['away_team_abbr'].iloc[0]
        def format_projections(team_df, team_abbr):
            players = []
            for _, p in team_df[team_df['team'].apply(get_team_abbr) == team_abbr].iterrows():
                player_name = master_player_df.loc[p['personId']]['playerName'] if p['personId'] in master_player_df.index else p['playerName']
                players.append({'personId': p['personId'], 'Player_Name': player_name, 'Predicted_Minutes': historical_minutes_map.get(p['personId'], ROOKIE_MINUTES_PLACEHOLDER), 'points': p['PTS'], 'reb': p['REB'], 'ast': p['AST']})
            return {'teamName': REVERSE_TEAM_MAP.get(team_abbr, team_abbr), 'winProb': 50, 'totalPoints': int(team_df[team_df['team'].apply(get_team_abbr) == team_abbr]['PTS'].sum()), 'players': players}
        projections_obj = [format_projections(game_pred_df, home_abbr), format_projections(game_pred_df, away_abbr)]; grade_obj = {"isGraded": False}
        if is_graded:
            game_actual_df['team_abbr'] = game_actual_df['playerteamName'].apply(get_team_abbr)
            actual_scores = game_actual_df.groupby('team_abbr')['PTS'].sum(); player_actuals = {int(p['personId']): {'PTS': p['PTS'], 'REB': p['REB'], 'AST': p['AST']} for _, p in game_actual_df.iterrows()}
            grade_obj = {"isGraded": True, "gameSummary": {"actual": {home_abbr: int(actual_scores.get(home_abbr, 0)), away_abbr: int(actual_scores.get(away_abbr, 0))}}, "playerActuals": player_actuals}
            game_pred_df['team_abbr'] = game_pred_df['team'].apply(get_team_abbr); pred_scores = game_pred_df.groupby('team_abbr')['PTS'].sum()
            pred_winner = pred_scores.idxmax() if not pred_scores.empty else None; actual_winner = actual_scores.idxmax() if not actual_scores.empty else None
            grade_obj['gameSummary']['predicted'] = {home_abbr: int(pred_scores.get(home_abbr, 0)), away_abbr: int(pred_scores.get(away_abbr, 0))}; grade_obj['correctWinner'] = bool(pred_winner == actual_winner)
            merged_players = pd.merge(game_pred_df[['personId', 'PTS']], game_actual_df[['personId', 'PTS']], on='personId', suffixes=('_pred', '_actual'))
            for _, row in merged_players.iterrows():
                pid = int(row['personId'])
                if pid not in player_perf_hist: player_perf_hist[pid] = []
                player_perf_hist[pid].append({'date': date, 'predicted_pts': row['PTS_pred'], 'actual_pts': row['PTS_actual']})
            grades.append({"date": date, "correctWinner": grade_obj['correctWinner']})
        if date not in daily_games: daily_games[date] = []
        daily_games[date].append({'projections': projections_obj, 'grade': grade_obj})
    logging.info(f"Generated daily games for {len(daily_games)} dates and {len(grades)} grades."); return daily_games, grades, player_perf_hist

def get_draft_category(draft_string):
    if not isinstance(draft_string, str): return 'Unknown'
    lower_draft = draft_string.lower()
    if 'undrafted' in lower_draft: return 'Undrafted'
    
    match = re.search(r'r(\d+)\s*/\s*p(\d+)', lower_draft)
    if not match: return 'Unknown'
    
    round_num, pick_num = int(match.group(1)), int(match.group(2))
    
    if round_num == 1:
        if pick_num == 1: return 'No. 1 Pick'
        if pick_num <= 5: return 'Top 5 Pick'
        return '1st Round (6+)'
    elif round_num == 2:
        return '2nd Round'
    else:
        return '3rd+ Round'

def generate_career_analysis_file(df_hist_raw, master_player_df):
    logging.info("Generating data for Career Analysis tab...");
    career_data_payload = {"players": {}, "by_position": {}, "by_draft_category": {}}
    if df_hist_raw.empty or master_player_df.empty:
        logging.warning("Career analysis skipped: Missing historical data or master player list.");
        with open(os.path.join(DATA_DIR, 'career_data.json'), 'w') as f: json.dump(sanitize_for_json(career_data_payload), f); return

    master_player_df['draftCategory'] = master_player_df['draftInfo'].apply(get_draft_category)
    
    df = pd.merge(df_hist_raw, master_player_df[['personId', 'position', 'birth_year', 'draftCategory']], on='personId', how='left')
    df = df.rename(columns=HISTORICAL_STAT_MAP)

    # ### FINAL PYTHON FIX: Correct the stat_cols list ###
    stat_cols = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'MIN']
    df[stat_cols] = df[stat_cols].apply(pd.to_numeric, errors='coerce')
    
    df['gameDate'] = pd.to_datetime(df['gameDate']); 
    df['age'] = (df['gameDate'].dt.year - df['birth_year']) + (df['gameDate'].dt.dayofyear / 365.25)

    df.dropna(subset=['personId', 'gameDate', 'age'] + stat_cols, inplace=True); df['personId'] = df['personId'].astype(int)
    df.sort_values(by=['personId', 'gameDate'], inplace=True); df['x_games'] = df.groupby('personId').cumcount() + 1
    df['year_month'] = df['gameDate'].dt.to_period('M')

    monthly_agg = df.groupby(['personId', 'year_month', 'position', 'draftCategory']).agg(
        **{s: (s, 'mean') for s in stat_cols}, 
        age=('age', 'mean'), 
        x_games=('x_games', 'max')
    ).reset_index()

    for stat in ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM']:
      monthly_agg[stat] = monthly_agg.groupby('personId')[stat].transform(lambda x: x.rolling(3, min_periods=1, center=True).mean())

    career_data_payload["players"] = {str(int(pid)): g[['x_games', 'age'] + stat_cols].to_dict('records') for pid, g in monthly_agg.groupby('personId')}
    
    def aggregate_by_group(group_col):
        df_agg = monthly_agg.dropna(subset=[group_col])
        if df_agg.empty: return {}
        agg = df_agg.groupby([group_col, 'year_month'])[['x_games', 'age'] + stat_cols].mean().reset_index()
        return {str(name): g[['x_games', 'age'] + stat_cols].to_dict('records') for name, g in agg.groupby(group_col)}

    career_data_payload['by_position'] = aggregate_by_group('position')
    career_data_payload['by_draft_category'] = aggregate_by_group('draftCategory')
    
    logging.info(f"Generated career data for {len(career_data_payload.get('players', {}))} players.")
    with open(os.path.join(DATA_DIR, 'career_data.json'), 'w') as f: json.dump(sanitize_for_json(career_data_payload), f)

def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', force=True)
    setup_environment()
    proj_df_raw = authenticate_and_load_sheet()
    if proj_df_raw.empty: return
    try: hist_df_raw = pd.read_csv(HISTORICAL_DATA_FILE, low_memory=False)
    except FileNotFoundError as e: logging.error(f"Critical file not found: {e}."); return

    build_player_universe(hist_df_raw, proj_df_raw)
    enriched_profiles = hybrid_scraper()
    master_player_df = pd.DataFrame.from_dict(enriched_profiles, orient='index')

    career_mpg_df = hist_df_raw.groupby('personId')['numMinutes'].agg(['mean', 'count']).reset_index()
    career_mpg_map = {row['personId']: row['mean'] for _, row in career_mpg_df.iterrows() if row['count'] > 20}
    for pid, profile in enriched_profiles.items():
        if pid in career_mpg_map:
            profile['careerAvgMpg'] = career_mpg_map[pid]
    
    logging.info("Calculating 5-game rolling average for minutes projection..."); hist_for_mins = hist_df_raw[['personId', 'gameDate', 'numMinutes']].copy()
    hist_for_mins['personId'] = pd.to_numeric(hist_for_mins['personId'], errors='coerce').dropna().astype(int)
    hist_for_mins['gameDate'] = pd.to_datetime(hist_for_mins['gameDate']); hist_for_mins.sort_values(by=['personId', 'gameDate'], inplace=True)
    rolling_mins = hist_for_mins.groupby('personId')['numMinutes'].rolling(window=5, min_periods=1).mean().reset_index()
    latest_rolling_mins = rolling_mins.loc[rolling_mins.groupby('personId')['level_1'].idxmax()]
    historical_minutes_map = latest_rolling_mins.set_index('personId')['numMinutes'].to_dict()
    logging.info(f"Created a rolling average minutes map for {len(historical_minutes_map)} players.")

    daily_games_data, historical_grades_data, player_perf_hist = generate_daily_games_and_grades(proj_df_raw, hist_df_raw, historical_minutes_map, master_player_df.set_index('personId'))
    for pid, history in player_perf_hist.items():
        if pid in enriched_profiles: enriched_profiles[pid]['performanceHistory'] = sorted(history, key=lambda x: x['date'])

    season_data = process_historical_data(hist_df_raw, master_player_df)
    proj_per_game, proj_total = process_projections(proj_df_raw, historical_minutes_map, master_player_df)

    manifest = {}; proj_per_game_z = calculate_z_scores(proj_per_game)
    with open(os.path.join(DATA_DIR, f'projections_{PROJECTION_YEAR}_full_per_game.json'), 'w') as f: json.dump(sanitize_for_json(proj_per_game_z.to_dict('records')), f, indent=2)
    with open(os.path.join(DATA_DIR, f'projections_{PROJECTION_YEAR}_full_total.json'), 'w') as f: json.dump(sanitize_for_json(proj_total.to_dict('records')), f, indent=2)
    manifest[f'projections_{PROJECTION_YEAR}_full_per_game'] = {'label': f'{PROJECTION_YEAR} Projections', 'split': 'projections'}

    for year, data in season_data.items():
        if year < PROJECTION_YEAR:
            data['per_game_z'] = calculate_z_scores(data['per_game'])
            with open(os.path.join(DATA_DIR, f'actuals_{year}_full_per_game.json'), 'w') as f: json.dump(sanitize_for_json(data['per_game_z'].to_dict('records')), f, indent=2)
            with open(os.path.join(DATA_DIR, f'actuals_{year}_full_total.json'), 'w') as f: json.dump(sanitize_for_json(data['total'].to_dict('records')), f, indent=2)
            manifest[f'actuals_{year}_full_per_game'] = {'label': f'{year} Full Season', 'split':'full'}

    logging.info("All season-long JSON files have been generated.");
    generate_specialty_files(season_data, proj_per_game_z);
    generate_career_analysis_file(hist_df_raw, master_player_df)

    master_json = { 
        "lastUpdated": datetime.now().isoformat(), 
        "seasonLongDataManifest": manifest, 
        "playerProfiles": enriched_profiles, 
        "dailyGamesByDate": daily_games_data, 
        "historicalGrades": historical_grades_data,
        "teamNameMap": WNBA_TEAM_NAME_MAP
    }
    with open(os.path.join(DIST_DIR, 'predictions.json'), 'w') as f: json.dump(sanitize_for_json(master_json), f, indent=2)

    logging.info("Creating zip file of the 'dist' directory...")
    shutil.make_archive(DIST_DIR, 'zip', DIST_DIR)
    logging.info("'dist.zip' created successfully.")

    logging.info("="*50); logging.info("✅ SUCCESS: All WNBA JSON data has been generated and sanitized."); logging.info(f"   Output is located in the '{DIST_DIR}' directory and zipped in 'dist.zip'."); logging.info("="*50)

if __name__ == '__main__':
    main()
