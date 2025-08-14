from playwright.sync_api import sync_playwright, Page, expect
import time

def verify_design(page: Page):
    """
    This script verifies the new light-themed design of the application.
    It explicitly waits for the CSS to be loaded and uses robust selectors.
    """
    try:
        # 1. Verify the Auth Page
        print("Navigating to Auth page...")
        page.goto("http://localhost:5173/auth", wait_until="networkidle")

        # Use a more specific locator to distinguish the title from the button
        heading = page.locator('div[data-slot="card-title"]', has_text="Sign In")
        expect(heading).to_be_visible(timeout=10000)

        print("Taking screenshot of Auth page...")
        page.screenshot(path="jules-scratch/verification/auth_page.png")
        print("Successfully captured Auth page.")

        # 2. Verify the Main Page
        print("Navigating to Main page...")
        page.goto("http://localhost:5173/", wait_until="networkidle")

        main_heading = page.get_by_role("heading", name="Speak with confidence.")
        expect(main_heading).to_be_visible(timeout=5000)

        print("Taking screenshot of Main page...")
        page.screenshot(path="jules-scratch/verification/main_page.png")
        print("Successfully captured Main page.")

        # 3. Verify the Session Page
        print("Navigating to Session page...")
        page.get_by_role("button", name="Start Your Free Session").click()
        page.wait_for_load_state('networkidle')

        transcript_heading = page.get_by_role("heading", name="Live Transcript")
        expect(transcript_heading).to_be_visible(timeout=5000)

        print("Taking screenshot of Session page...")
        page.screenshot(path="jules-scratch/verification/session_page.png")
        print("Successfully captured Session page.")

    except Exception as e:
        print(f"An error occurred during verification: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")
        print("Took an error screenshot for debugging.")
        raise

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state={"cookies": [], "origins": []})
        page = context.new_page()
        try:
            verify_design(page)
        finally:
            browser.close()
            print("Verification script finished.")
