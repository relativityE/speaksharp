from playwright.sync_api import sync_playwright, Page, expect
import time

def verify_pages(page: Page):
    """
    This script verifies the main pages of the application, ensuring CSS has loaded.
    """
    try:
        # 1. Navigate to the Auth page and take a screenshot.
        print("Navigating to Auth page...")
        page.goto("http://localhost:5173/auth")

        # Wait for all network requests to finish, ensuring CSS is loaded.
        page.wait_for_load_state('networkidle')

        # Now that styles are loaded, we can assert on the role.
        heading = page.get_by_role("heading", name="Welcome Back")
        expect(heading).to_be_visible(timeout=5000)

        print("Taking screenshot of Auth page...")
        page.screenshot(path="jules-scratch/verification/auth_page.png")
        print("Successfully took screenshot of Auth page.")

        # 2. Navigate to the Main page (Home) and take a screenshot.
        print("Navigating to Main page...")
        page.goto("http://localhost:5173/")
        page.wait_for_load_state('networkidle')

        main_heading = page.get_by_role("heading", name="Real-Time Filler Word Detection")
        expect(main_heading).to_be_visible(timeout=5000)

        login_button = page.get_by_role("button", name="Login / Sign Up")
        expect(login_button).to_be_visible()

        print("Taking screenshot of Main page...")
        page.screenshot(path="jules-scratch/verification/main_page.png")
        print("Successfully took screenshot of Main page.")

        # 3. Navigate to the Session page and take a screenshot.
        print("Navigating to Session page...")
        start_button = page.get_by_role("button", name="Start Your Session")
        start_button.click()

        page.wait_for_load_state('networkidle')

        transcript_heading = page.get_by_role("heading", name="Live Transcript")
        expect(transcript_heading).to_be_visible(timeout=5000)

        print("Taking screenshot of Session page...")
        page.screenshot(path="jules-scratch/verification/session_page.png")
        print("Successfully took screenshot of Session page.")

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
        verify_pages(page)
        browser.close()
        print("Verification script finished.")
