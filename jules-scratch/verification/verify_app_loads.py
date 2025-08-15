from playwright.sync_api import sync_playwright, expect
import sys

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for all console events and print them
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}", file=sys.stderr))

        try:
            # Navigate to the local development server
            page.goto("http://localhost:5173/", timeout=15000)

            # Wait for the main heading
            heading = page.get_by_role("heading", name="Speak with confidence.")
            expect(heading).to_be_visible(timeout=20000)

            # If successful, take the verification screenshot
            page.screenshot(path="jules-scratch/verification/verification.png")
            print("Verification successful, screenshot taken.")

        except Exception as e:
            print("Verification failed. Saving debug screenshot to 'jules-scratch/verification/debug_screenshot.png'", file=sys.stderr)
            # On failure, take a debug screenshot
            page.screenshot(path="jules-scratch/verification/debug_screenshot.png")
            raise e

        finally:
            browser.close()

run_verification()
