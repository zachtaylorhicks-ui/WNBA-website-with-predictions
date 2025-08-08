
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

WNBA_ROSTER_URL = "https://en.wikipedia.org/wiki/List_of_current_WNBA_team_rosters"
WNBA_ALL_PLAYERS_URL = "https://en.wikipedia.org/wiki/List_of_Women%27s_National_Basketball_Association_players"
INJURY_URL = "https://www.covers.com/sport/basketball/wnba/injuries"
WNBA_TEAM_NAME_MAP = { "Atlanta Dream": "ATL", "Chicago Sky": "CHI", "Connecticut Sun": "CON", "Dallas Wings": "DAL", "Indiana Fever": "IND", "Las Vegas Aces": "LVA", "Los Angeles Sparks": "LAS", "Minnesota Lynx": "MIN", "New York Liberty": "NYL", "Phoenix Mercury": "PHO", "Seattle Storm": "SEA", "Washington Mystics": "WAS", "Golden State Valkyries": "GSV", 'Atlanta': 'ATL', 'Chicago': 'CHI', 'Connecticut': 'CON', 'Dallas': 'DAL', 'Indiana': 'IND', 'Las Vegas': 'LVA', 'Los Angeles': 'LAS', 'Minnesota': 'MIN', 'New York': 'NYL', 'Phoenix': 'PHO', 'Seattle': 'SEA', 'Washington': 'WAS', 'Golden State': 'GSV' }

# --- CORE FUNCTIONS (Extracted & Refined) ---
class WNBAStatsScraper:
    BASE_URL = "https://stats.wnba.com/stats/playergamelogs"
    HEADERS = { 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.wnba.com', 'Referer': 'https://www.wnba.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }

    def __init__(self, timeout=45, max_retries=3, backoff_factor=5):
        self.session = curl_requests.Session(impersonate="chrome120", headers=self.HEADERS)
        self.timeout, self.max_retries, self.backoff_factor = timeout, max_retries, backoff_factor

    def fetch_season_data(self, year, season_type):
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
                return df
            except Exception as e:
                logging.error(f"Attempt {attempt + 1}/{self.max_retries} failed for {year} {season_type}: {e}")
                if attempt < self.max_retries - 1: time.sleep(self.backoff_factor * (attempt + 1))
        return None

def update_stats_database():
    logging.info("--- Starting Stats Database Update ---")
    if not os.path.exists(STATS_FILE):
        logging.error(f"FATAL: Base stats file not found at '{STATS_FILE}'. Aborting.")
        return

    try:
        current_year = pd.Timestamp.now().year
        df_historical = pd.read_csv(STATS_FILE)
        logging.info(f"Loaded {len(df_historical)} rows from existing stats database.")

        scraper = WNBAStatsScraper()
        all_new_data = []
        for season_type in ['Regular Season', 'Playoffs']:
            logging.info(f"Fetching {current_year} {season_type} data...")
            df_new = scraper.fetch_season_data(year=current_year, season_type=season_type)
            if df_new is not None and not df_new.empty:
                df_new['YEAR'] = current_year
                df_new['SEASON_TYPE'] = season_type
                all_new_data.append(df_new)
                time.sleep(2)

        if not all_new_data:
            logging.info("No new stats data found from scraper. Database is up-to-date.")
            return

        df_scraped_total = pd.concat(all_new_data, ignore_index=True)
        
        # Integrity Check
        if 'PLAYER_ID' not in df_scraped_total.columns or 'GAME_ID' not in df_scraped_total.columns:
            logging.error("FATAL: Scraped data is malformed (missing PLAYER_ID or GAME_ID). Aborting update.")
            return
        
        logging.info(f"Scraped a total of {len(df_scraped_total)} new rows for {current_year}.")
        
        # Failsafe Merge
        df_combined = pd.concat([df_historical, df_scraped_total], ignore_index=True)
        initial_rows = len(df_combined)
        df_combined.drop_duplicates(subset=['PLAYER_ID', 'GAME_ID'], keep='last', inplace=True)
        final_rows = len(df_combined)
        
        logging.info(f"Combined and de-duplicated. Added {final_rows - len(df_historical)} new/updated rows.")
        
        df_combined.to_csv(STATS_FILE, index=False)
        logging.info(f"✅ Successfully updated stats database at '{STATS_FILE}'.")

    except Exception as e:
        logging.error(f"An unexpected error occurred during stats update: {e}", exc_info=True)

def update_injuries():
    logging.info("--- Starting Hourly Injury Update ---")
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
                if player_link_tag and player_link_tag.has_attr('href'):
                    player_name = player_link_tag['href'].split('/')[-1].replace('-', ' ').title()
                    status = re.sub(r'\s+', ' ', cells[2].get_text(strip=True))
                    updated_date = cells[1].get_text(strip=True)
                    details = cells[3].get_text(strip=True)
                    
                    all_injuries.append({
                        'player_name': player_name,
                        'status': status,
                        'date': updated_date,
                        'details': details
                    })

        logging.info(f"Scraped {len(all_injuries)} injury reports.")
        with open(INJURY_FILE, 'w') as f:
            json.dump(all_injuries, f, indent=2)
        logging.info(f"✅ Successfully updated injury file at '{INJURY_FILE}'.")
        
    except Exception as e:
        logging.warning(f"Could not update injury file, leaving the old one in place. Error: {e}")

# This part will be a simplified version of your hybrid scraper for now.
def update_player_info_cache():
    logging.info("--- Starting Player Info Cache Update ---")
    # Placeholder for the more complex player info scraping logic.
    # For now, we ensure the file exists.
    # The full logic from your `hybrid_scraper` can be pasted here later.
    if not os.path.exists(PLAYER_CACHE_FILE):
        with open(PLAYER_CACHE_FILE, 'w') as f:
            json.dump({}, f)
        logging.info("Created empty player info cache.")
    else:
        logging.info("Player info cache already exists. (Full update logic to be implemented).")
    logging.info(f"✅ Player Info Cache update process finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WNBA Data Updater Script")
    parser.add_argument("--injuries-only", action="store_true", help="Only update the injury data.")
    args = parser.parse_args()

    if args.injuries_only:
        update_injuries()
    else:
        update_stats_database()
        update_player_info_cache()
        update_injuries() # Also run injuries during the daily update

    logging.info("--- Updater Script Finished ---")
