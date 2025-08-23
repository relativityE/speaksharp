import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # --- Verification for Global Font Size ---
    # We will navigate to the main page to verify the font size change,
    # as other pages are blocked by a Supabase connection issue in the test environment.
    print("Navigating to Main page to verify font size...")
    page.goto("http://localhost:5173/")

    # Wait for the main heading to be visible.
    heading = page.get_by_text("Speak with confidence.")
    expect(heading).to_be_visible()

    print("Taking screenshot of Main page...")
    page.screenshot(path="jules-scratch/verification/main_page_font_size.png")

    # --- Blocked Verifications ---
    # The following verifications for the Analytics page contrast fix and the
    # Cloud Mode error message cannot be completed because the pages are stuck
    # in a loading state, likely due to a missing Supabase configuration in the
    # test environment. The code changes have been implemented as requested,
    # but cannot be visually verified at this time.

    # ---------------------
    context.close()
    browser.close()

with sync_playwright() as playwright:
    run(playwright)

print("Verification script finished.")
