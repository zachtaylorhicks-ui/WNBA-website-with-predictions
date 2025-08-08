# /run_data_updates.py
# This script is a direct port of the trusted scraping and data processing
# functions from the provided Colab notebooks.

import pandas as pd
import numpy as np
import json
import os
import logging
import time
import requests
from bs4 import BeautifulSoup
import re
import unicodedata
import argparse
from curl_cffi import requests as curl_requests
from fuzzywuzzy import process, fuzz

# --- CONFIGURATION ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', force=True)

DATABASE_DIR = "database"
STATS_FILE = os.path.join(DATABASE_DIR, "wnba_all_player_boxscores.csv")
PLAYER_CACHE_FILE = os.path.join(DATABASE_DIR, "player_info_cache.json")
INJURY_FILE = os.path.join(DATABASE_DIR, "live_injuries.json")
BASE_BOXSCORE_FILE = os.path.join(DATABASE_DIR, "wnba_all_player_boxscores_1997-2025.csv") # Base file for name mapping

WNBA_ROSTER_URL = "https://en.wikipedia.org/wiki/List_of_current_WNBA_team_rosters"
WNBA_ALL_PLAYERS_URL = "https://en.wikipedia.org/wiki/List_of_Women%27s_National_Basketball_Association_players"
INJURY_URL = "https://www.covers.com/sport/basketball/wnba/injuries"
WNBA_TEAM_NAME_MAP = { "Atlanta Dream": "ATL", "Chicago Sky": "CHI", "Connecticut Sun": "CON", "Dallas Wings": "DAL", "Indiana Fever": "IND", "Las Vegas Aces": "LVA", "Los Angeles Sparks": "LAS", "Minnesota Lynx": "MIN", "New York Liberty": "NYL", "Phoenix Mercury": "PHO", "Seattle Storm": "SEA", "Washington Mystics": "WAS", "Golden State Valkyries": "GSV", 'Atlanta': 'ATL', 'Chicago': 'CHI', 'Connecticut': 'CON', 'Dallas': 'DAL', 'Indiana': 'IND', 'Las Vegas': 'LVA', 'Los Angeles': 'LAS', 'Minnesota': 'MIN', 'New York': 'NYL', 'Phoenix': 'PHO', 'Seattle': 'SEA', 'Washington': 'WAS', 'Golden State': 'GSV' }

# --- 1. STATS DATABASE SCRAPER (FROM COLAB) ---
class WNBA_Production_Scraper:
    BASE_URL = "https://stats.wnba.com/stats/playergamelogs"
    HEADERS = { 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.wnba.com', 'Referer': 'https://www.wnba.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    def __init__(self, timeout: int = 45, max_retries: int = 3, backoff_factor: int = 5):
        self.session = curl_requests.Session(impersonate="chrome120", headers=self.HEADERS)
        self.timeout, self.max_retries, self.backoff_factor = timeout, max_retries, backoff_factor

    def _fetch_season_data(self, year: int, season_type: str) -> pd.DataFrame | None:
        logging.info(f"--- Fetching data for {year} {season_type} ---")
        params = {'LeagueID': '10', 'Season': str(year), 'SeasonType': season_type, 'MeasureType': 'Base', 'PerMode': 'PerGame'}
        for attempt in range(self.max_retries):
            try:
                response = self.session.get(self.BASE_URL, params=params, timeout=self.timeout)
                response.raise_for_status()
                data = response.json()
                if not data.get('resultSets') or not data['resultSets'][0].get('rowSet'):
                    logging.info(f"API returned no data for {year} {season_type}.")
                    return None
                df = pd.DataFrame(data['resultSets'][0]['rowSet'], columns=data['resultSets'][0]['headers'])
                logging.info(f"Successfully parsed {len(df)} rows for {year} {season_type}.")
                return df
            except Exception as e:
                logging.error(f"Attempt {attempt + 1}/{self.max_retries} failed for {year} {season_type}: {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(self.backoff_factor * (attempt + 1))
        return None

def update_stats_database():
    logging.info("--- Starting Stats Database Update using Colab Logic ---")
    if not os.path.exists(STATS_FILE):
        logging.error(f"FATAL: Base stats file not found at '{STATS_FILE}'. Aborting.")
        return

    current_year = pd.Timestamp.now().year
    historical_df = pd.read_csv(STATS_FILE)
    logging.info(f"Loaded {len(historical_df)} rows from existing stats database.")

    scraper = WNBA_Production_Scraper()
    season_types = ['Regular Season', 'Playoffs']
    refreshed_data = []
    for st in season_types:
        df = scraper._fetch_season_data(year=current_year, season_type=st)
        if df is not None and not df.empty:
            df['YEAR'] = current_year
            df['SEASON_TYPE'] = st
            refreshed_data.append(df)
            time.sleep(2)
    
    if not refreshed_data:
        logging.info("Live scrape returned no new data. Database is up-to-date.")
        return

    newly_scraped_df = pd.concat(refreshed_data, ignore_index=True)
    logging.info(f"Live scrape successful. Fetched {len(newly_scraped_df)} total rows for the {current_year} season.")

    combined_df = pd.concat([historical_df, newly_scraped_df], ignore_index=True)
    combined_df.drop_duplicates(subset=['PLAYER_ID', 'GAME_ID'], keep='last', inplace=True)
    
    rows_added = len(combined_df) - len(historical_df)
    logging.info(f"Final dataset now contains {len(combined_df)} total rows. Added {rows_added} new/updated rows.")
    
    combined_df.to_csv(STATS_FILE, index=False)
    logging.info(f"✅ Successfully updated stats database at '{STATS_FILE}'.")


# --- 2. INJURY SCRAPER (FROM COLAB) ---
def update_injuries():
    logging.info("--- Starting Hourly Injury Update using Colab Logic ---")
    all_injuries = []
    try:
        response = requests.get(INJURY_URL, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        
        for container in soup.find_all('div', class_='covers-CoversSeasonInjuries-blockContainer'):
            injury_table = container.find('table', class_='covers-CoversMatchups-Table')
            if not injury_table: continue
            for row in injury_table.find('tbody').find_all('tr'):
                if 'No injuries' in row.text: continue
                cells = row.find_all('td')
                if len(cells) != 4: continue
                
                player_link_tag = cells[0].find('a')
                player_name = cells[0].get_text(strip=True)
                if player_link_tag and player_link_tag.has_attr('href'):
                    # Prefer the name from the URL slug as it's cleaner
                    player_name = player_link_tag['href'].split('/')[-1].replace('-', ' ').title()
                
                status = re.sub(r'\s+', ' ', cells[2].get_text(strip=True))
                updated_date = cells[1].get_text(strip=True)
                details = cells[3].get_text(strip=True)
                
                all_injuries.append({
                    'player_name': player_name, 'status': status, 'date': updated_date, 'details': details
                })

        logging.info(f"Scraped {len(all_injuries)} injury reports.")
        with open(INJURY_FILE, 'w') as f:
            json.dump(all_injuries, f, indent=2)
        logging.info(f"✅ Successfully updated injury file at '{INJURY_FILE}'.")
        
    except Exception as e:
        logging.warning(f"Could not update injury file. Error: {e}")


# --- 3. PLAYER INFO/ENRICHMENT SCRAPER (HYBRID SCRAPER FROM COLAB) ---
# Global variables for the hybrid scraper functions
PLAYER_ID_NAME_MAP, NORMALIZED_NAME_TO_ID_MAP, NORMALIZED_CANONICAL_NAMES = {}, {}, []

def normalize_name(name):
    if not isinstance(name, str): return ""
    return "".join(c for c in unicodedata.normalize('NFKD', name.lower()) if not unicodedata.combining(c))

def get_player_id_from_name(name, threshold=90):
    normalized_name = normalize_name(name)
    if normalized_name in NORMALIZED_NAME_TO_ID_MAP: return NORMALIZED_NAME_TO_ID_MAP[normalized_name]
    match, score = process.extractOne(normalized_name, NORMALIZED_CANONICAL_NAMES, scorer=fuzz.token_set_ratio)
    return NORMALIZED_NAME_TO_ID_MAP.get(match) if match and score >= threshold else None

def build_player_universe():
    global PLAYER_ID_NAME_MAP, NORMALIZED_NAME_TO_ID_MAP, NORMALIZED_CANONICAL_NAMES
    if not os.path.exists(BASE_BOXSCORE_FILE):
        logging.error(f"Cannot build player universe, base file not found: {BASE_BOXSCORE_FILE}")
        return
    hist_df = pd.read_csv(BASE_BOXSCORE_FILE, usecols=['PLAYER_ID', 'PLAYER_NAME'], low_memory=False)
    hist_players = hist_df.dropna().drop_duplicates(subset='PLAYER_ID')
    hist_players['PLAYER_ID'] = pd.to_numeric(hist_players['PLAYER_ID'], errors='coerce').dropna().astype(int)
    for _, row in hist_players.iterrows():
        pid, name = row['PLAYER_ID'], row['PLAYER_NAME']
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

def enrich_player_profiles(player_profiles):
    logging.info(f"--- Enriching {len(player_profiles)} player profiles with infobox details ---")
    for pid, profile in player_profiles.items():
        if 'wikiUrl' not in profile or not profile['wikiUrl']: continue
        try:
            time.sleep(0.05)
            response = requests.get(profile['wikiUrl'], headers={'User-Agent': 'Mozilla/5.0'})
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            infobox = soup.find('table', class_='infobox')
            if not infobox: continue

            def get_info(label_regex):
                header = infobox.find('th', string=re.compile(label_regex, re.I))
                return header.find_next_sibling('td').get_text(strip=True, separator=' ') if header and header.find_next_sibling('td') else 'N/A'
            
            profile['position'] = standardize_position(get_info(r'(Listed )?Position'))
        except Exception as e:
            logging.warning(f"  - Could not enrich profile for {profile.get('playerName', pid)}: {e}")
            profile.setdefault('position', 'N/A')
    return player_profiles

def update_player_info_cache():
    logging.info("--- Starting Player Info Cache Update using Colab Hybrid Scraper ---")
    build_player_universe()
    if not PLAYER_ID_NAME_MAP: return

    # Stage 1: Scrape Current Rosters
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
                player_name_text = cells[3].get_text(strip=True); link_tag = cells[3].find('a')
                if not player_name_text or not link_tag or not link_tag.has_attr('href'): continue
                pid = get_player_id_from_name(player_name_text, threshold=88)
                if pid:
                    active_player_profiles[pid] = { 'personId': pid, 'playerName': PLAYER_ID_NAME_MAP.get(pid, player_name_text), 'team': team_abbreviation, 'wikiUrl': f"https://en.wikipedia.org{link_tag['href']}" }
    except Exception as e: logging.error(f"Roster scrape failed: {e}")
    
    logging.info(f"Found {len(active_player_profiles)} active players with team assignments.")

    # Stage 2: Scrape All Players List
    historical_player_profiles = {}
    try:
        response = requests.get(WNBA_ALL_PLAYERS_URL, headers={'User-Agent': 'Mozilla/5.0'}); response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser'); content_div = soup.find('div', class_='mw-parser-output')
        for ul_tag in content_div.find_all('ul'):
            for li_tag in ul_tag.find_all('li'):
                link_tag = li_tag.find('a');
                if link_tag and link_tag.has_attr('href') and not link_tag['href'].startswith('/wiki/File:'):
                    player_name_text = link_tag.get_text(strip=True)
                    pid = get_player_id_from_name(player_name_text, threshold=95)
                    if pid:
                        historical_player_profiles[pid] = { 'personId': pid, 'playerName': PLAYER_ID_NAME_MAP.get(pid, player_name_text), 'team': 'FA', 'wikiUrl': f"https://en.wikipedia.org{link_tag['href']}" }
    except Exception as e: logging.error(f"All-players scrape failed: {e}")

    # Stage 3: Merge and Enrich
    final_profiles = {**historical_player_profiles, **active_player_profiles}
    enriched_profiles = enrich_player_profiles(final_profiles)
    
    with open(PLAYER_CACHE_FILE, 'w') as f:
        json.dump(enriched_profiles, f, indent=2)
    logging.info(f"✅ Successfully updated player info cache for {len(enriched_profiles)} players at '{PLAYER_CACHE_FILE}'.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WNBA Data Updater Script using Trusted Colab Logic")
    parser.add_argument("--stats", action="store_true", help="Only update the stats database.")
    parser.add_argument("--injuries", action="store_true", help="Only update the injury data.")
    parser.add_argument("--players", action="store_true", help="Only update the player info cache.")
    args = parser.parse_args()

    if not any([args.stats, args.injuries, args.players]):
        # If no flags are specified, run all updates.
        update_stats_database()
        update_player_info_cache()
        update_injuries()
    else:
        # Run only the specified updates.
        if args.stats:
            update_stats_database()
        if args.players:
            update_player_info_cache()
        if args.injuries:
            update_injuries()

    logging.info("--- Updater Script Finished ---")
