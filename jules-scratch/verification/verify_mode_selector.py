import time
from playwright.sync_api import sync_playwright, expect

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # Go to the root page
        page.goto("http://localhost:5173/", timeout=30000)

        # Wait for a moment to ensure the page has time to render
        time.sleep(5)

        # Take a screenshot
        screenshot_path = "jules-scratch/verification/homepage.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

    except Exception as e:
        print(f"An error occurred: {e}")
        # Try to take a screenshot even on error
        page.screenshot(path="jules-scratch/verification/error.png")
    finally:
        # Add a small delay to ensure file is written
        time.sleep(2)
        browser.close()

with sync_playwright() as playwright:
    run_verification(playwright)
