import time
from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            print("Navigating to http://localhost:5173/...")
            # Set a longer timeout to ensure we see the result of the hang
            page.goto("http://localhost:5173/", timeout=60000)

            print("Navigation complete. Waiting for 5 seconds...")
            time.sleep(5) # Wait to see if any errors appear asynchronously

            screenshot_path = "jules-scratch/verification/startup_screenshot.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"An error occurred during verification: {e}")
            # Try to take a screenshot even if an error occurred
            error_screenshot_path = "jules-scratch/verification/startup_error.png"
            page.screenshot(path=error_screenshot_path)
            print(f"Error screenshot saved to {error_screenshot_path}")
        finally:
            browser.close()

if __name__ == "__main__":
    run_verification()
