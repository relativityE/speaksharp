from playwright.sync_api import sync_playwright, expect
import time

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate directly to the auth page to log in
            page.goto("http://localhost:5173/auth")

            # Wait for the page to be ready by waiting for the heading
            expect(page.get_by_role("heading", name="Sign In")).to_be_visible()

            # Fill in the login form
            page.get_by_test_id("email-input").fill("free-user@test.com")
            page.get_by_test_id("password-input").fill("password123")
            page.get_by_test_id("sign-in-submit").click()

            # After login, the app should redirect to the root, which then renders the SessionPage
            # Wait for the main session page heading to be visible
            expect(page.get_by_role("heading", name="Practice Session")).to_be_visible(timeout=10000)

            print("On session page. Taking screenshot...")

            # Take a screenshot
            screenshot_path = "jules-scratch/verification/free_session_page.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"An error occurred: {e}")
            page.screenshot(path="jules-scratch/verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    run_verification()
