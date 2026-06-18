"""
Plynth LinkedIn Auto-Apply Bot Bridge

Runs locally as a systemd service. Polls Supabase for pending bot_runs,
executes headless Chrome Selenium automation, syncs results back.

Usage:
  python3 bot_bridge.py

Requires:
  - Chrome/Chromium installed
  - chromedriver (managed by webdriver-manager)
  - Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

import os
import sys
import time
import json
import traceback
from datetime import datetime

from supabase import create_client, Client
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

# --- Config ---
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
POLL_INTERVAL = 10  # seconds between polling for new commands
LINKEDIN_PASSWORD = os.environ.get('LINKEDIN_PASSWORD', '')  # stored locally only

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    sys.exit(1)

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def update_run(run_id: str, **kwargs):
    """Update a bot_run record."""
    kwargs['updated_at'] = datetime.utcnow().isoformat()
    sb.table('bot_runs').update(kwargs).eq('id', run_id).execute()


def get_linkedin_config(user_id: str) -> dict | None:
    """Get user's LinkedIn config."""
    res = sb.table('linkedin_config').select('*').eq('user_id', user_id).maybe_single().execute()
    return res.data


def create_driver() -> webdriver.Chrome:
    """Create headless Chrome driver."""
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    driver.implicitly_wait(10)
    return driver


def linkedin_login(driver: webdriver.Chrome, email: str) -> bool:
    """Login to LinkedIn. Returns True on success."""
    password = LINKEDIN_PASSWORD
    if not password:
        log("ERROR: LINKEDIN_PASSWORD not set in environment")
        return False
    
    driver.get("https://www.linkedin.com/login")
    time.sleep(3)
    
    try:
        username_field = driver.find_element(By.ID, "username")
        username_field.clear()
        username_field.send_keys(email)
        
        password_field = driver.find_element(By.ID, "password")
        password_field.clear()
        password_field.send_keys(password)
        password_field.send_keys(Keys.ENTER)
        time.sleep(8)
        
        # Check if login succeeded (look for feed or jobs nav)
        if "feed" in driver.current_url or "jobs" in driver.current_url:
            log("LinkedIn login successful")
            return True
        
        # Check for security checkpoint
        if "checkpoint" in driver.current_url or "challenge" in driver.current_url:
            log("ERROR: LinkedIn security checkpoint detected - manual verification needed")
            return False
            
        log(f"WARNING: Unexpected post-login URL: {driver.current_url}")
        return False
    except Exception as e:
        log(f"ERROR: Login failed: {e}")
        return False


def search_and_apply(driver: webdriver.Chrome, run: dict) -> list[dict]:
    """Search for jobs and auto-apply to EasyApply ones."""
    applied_jobs = []
    keywords = run['keywords']
    location = run['location']
    max_applies = run.get('max_applies', 25)
    remote_only = run.get('remote_only', False)
    
    # Navigate to LinkedIn jobs with EasyApply filter
    search_url = f"https://www.linkedin.com/jobs/search/?keywords={keywords}&location={location}&f_AL=true"
    if remote_only:
        search_url += "&f_WT=2"  # Remote filter
    
    driver.get(search_url)
    time.sleep(5)
    
    log(f"Searching: keywords='{keywords}', location='{location}', remote={remote_only}")
    
    # Get job cards
    job_cards = driver.find_elements(By.CSS_SELECTOR, ".job-card-container")
    if not job_cards:
        job_cards = driver.find_elements(By.CSS_SELECTOR, "[data-job-id]")
    
    log(f"Found {len(job_cards)} job cards")
    
    for i, card in enumerate(job_cards):
        if len(applied_jobs) >= max_applies:
            log(f"Reached max applies limit ({max_applies})")
            break
        
        try:
            # Click job card to open details
            driver.execute_script("arguments[0].scrollIntoView(true);", card)
            time.sleep(1)
            card.click()
            time.sleep(3)
            
            # Get job info
            try:
                title_el = driver.find_element(By.CSS_SELECTOR, ".job-details-jobs-unified-top-card__job-title")
                company_el = driver.find_element(By.CSS_SELECTOR, ".job-details-jobs-unified-top-card__company-name")
                title = title_el.text.strip()
                company = company_el.text.strip()
            except:
                title = f"Job #{i+1}"
                company = "Unknown"
            
            # Check if already applied
            try:
                applied_badge = driver.find_element(By.CSS_SELECTOR, ".artdeco-inline-feedback__message")
                if "Applied" in applied_badge.text:
                    log(f"  Already applied: {title} @ {company}")
                    continue
            except:
                pass
            
            # Click Easy Apply button
            try:
                apply_btn = driver.find_element(By.CSS_SELECTOR, ".jobs-apply-button")
                if "Easy Apply" not in apply_btn.text:
                    continue
                apply_btn.click()
                time.sleep(2)
            except:
                log(f"  No Easy Apply button: {title}")
                continue
            
            # Navigate through application steps
            success = complete_application(driver)
            
            if success:
                log(f"  ✓ Applied: {title} @ {company}")
                job_url = driver.current_url.split('?')[0]
                applied_jobs.append({
                    'title': title,
                    'company': company,
                    'job_url': job_url,
                    'applied_at': datetime.utcnow().isoformat(),
                })
                
                # Update progress in DB
                update_run(run['id'], 
                    applied_count=len(applied_jobs),
                    jobs_applied=json.dumps(applied_jobs))
            else:
                log(f"  ✗ Failed: {title} @ {company}")
                dismiss_modal(driver)
            
            time.sleep(2)
            
        except Exception as e:
            log(f"  Error on card {i}: {e}")
            dismiss_modal(driver)
            continue
    
    return applied_jobs


def complete_application(driver: webdriver.Chrome) -> bool:
    """Click through Next/Review/Submit steps. Returns True if submitted."""
    max_steps = 10
    for step in range(max_steps):
        time.sleep(2)
        
        # Check for required fields with errors
        errors = driver.find_elements(By.CSS_SELECTOR, ".artdeco-inline-feedback--error")
        if errors:
            log(f"    Required fields not filled (step {step})")
            return False
        
        # Try Submit
        try:
            submit = driver.find_element(By.XPATH, "//*[@aria-label='Submit application']")
            submit.click()
            time.sleep(3)
            return True
        except:
            pass
        
        # Try Review
        try:
            review = driver.find_element(By.XPATH, "//*[@aria-label='Review your application']")
            review.click()
            time.sleep(2)
            continue
        except:
            pass
        
        # Try Next
        try:
            next_btn = driver.find_element(By.XPATH, "//*[@aria-label='Continue to next step']")
            next_btn.click()
            time.sleep(2)
            continue
        except:
            pass
        
        # Nothing worked
        return False
    
    return False


def dismiss_modal(driver: webdriver.Chrome):
    """Dismiss any open application modal."""
    try:
        dismiss = driver.find_element(By.XPATH, "//*[@aria-label='Dismiss']")
        dismiss.click()
        time.sleep(1)
        # Confirm discard
        try:
            discard = driver.find_element(By.XPATH, "//*[@data-control-name='discard_application_confirm_btn']")
            discard.click()
        except:
            try:
                discard = driver.find_element(By.XPATH, "//*[@data-control-name='save_application_btn']")
                discard.click()
            except:
                pass
        time.sleep(1)
    except:
        pass


def sync_to_applications(user_id: str, applied_jobs: list[dict]):
    """Insert applied jobs into job_applications table."""
    for job in applied_jobs:
        try:
            sb.table('job_applications').insert({
                'user_id': user_id,
                'company': job['company'],
                'role': job['title'],
                'job_url': job.get('job_url', ''),
                'applied_date': datetime.utcnow().strftime('%Y-%m-%d'),
                'status': 'applied',
                'notes': 'Auto-applied by LinkedIn Bot',
            }).execute()
        except Exception as e:
            log(f"  Failed to sync job to applications: {e}")


def process_run(run: dict):
    """Process a single bot run."""
    run_id = run['id']
    user_id = run['user_id']
    
    log(f"Processing run {run_id[:8]}... for user {user_id[:8]}...")
    update_run(run_id, status='running')
    
    # Get user's LinkedIn config
    config = get_linkedin_config(user_id)
    if not config or not config.get('linkedin_email'):
        update_run(run_id, status='failed', error_message='LinkedIn email not configured')
        return
    
    driver = None
    try:
        driver = create_driver()
        
        # Login
        if not linkedin_login(driver, config['linkedin_email']):
            update_run(run_id, status='failed', error_message='LinkedIn login failed (check password or security checkpoint)')
            return
        
        # Search and apply
        applied_jobs = search_and_apply(driver, run)
        
        # Sync results to job_applications
        if applied_jobs:
            sync_to_applications(user_id, applied_jobs)
        
        # Mark completed
        update_run(run_id,
            status='completed',
            applied_count=len(applied_jobs),
            jobs_applied=json.dumps(applied_jobs))
        
        log(f"Run {run_id[:8]} completed: {len(applied_jobs)} jobs applied")
        
    except Exception as e:
        log(f"Run {run_id[:8]} failed: {e}")
        traceback.print_exc()
        update_run(run_id, status='failed', error_message=str(e)[:500])
    finally:
        if driver:
            driver.quit()


def check_stop_commands():
    """Cancel any runs that received a stop command."""
    res = sb.table('bot_runs') \
        .select('id') \
        .eq('command', 'stop') \
        .eq('status', 'pending') \
        .execute()
    
    for run in (res.data or []):
        update_run(run['id'], status='cancelled')
        log(f"Cancelled run {run['id'][:8]}")


def poll_loop():
    """Main polling loop."""
    log("LinkedIn Bot Bridge started. Polling for commands...")
    
    while True:
        try:
            # Check for stop commands
            check_stop_commands()
            
            # Get next pending start command
            res = sb.table('bot_runs') \
                .select('*') \
                .eq('command', 'start') \
                .eq('status', 'pending') \
                .order('created_at', desc=False) \
                .limit(1) \
                .execute()
            
            if res.data:
                process_run(res.data[0])
            
        except Exception as e:
            log(f"Poll error: {e}")
        
        time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    poll_loop()
