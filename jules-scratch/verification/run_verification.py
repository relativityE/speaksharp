from playwright.sync_api import sync_playwright, Page
import sys
import os

def take_screenshot(page: Page, url: str, path: str):
    """Navigates to a URL and takes a screenshot."""
    print(f"Navigating to {url}...", flush=True)
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2000) # Wait for basic styling
    print(f"Taking screenshot of {url}...", flush=True)
    page.screenshot(path=path)
    print(f"Screenshot saved to {path}", flush=True)

def main():
    """
    Main function to run the verification script.
    Takes screenshots of the main, session, and analytics pages.
    """
    print("Starting verification script with multiple screenshots...", flush=True)

    # Ensure the output directory exists
    output_dir = "jules-scratch/verification"
    os.makedirs(output_dir, exist_ok=True)

    try:
        with sync_playwright() as p:
            print("Playwright started", flush=True)

            browser = p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ]
            )
            print("Browser launched", flush=True)

            page = browser.new_page()
            page.set_default_timeout(30000)
            print("Page created", flush=True)

            # Take screenshots of different pages
            take_screenshot(page, "http://localhost:5173/", os.path.join(output_dir, "main-page.png"))
            take_screenshot(page, "http://localhost:5173/session", os.path.join(output_dir, "session-page.png"))
            take_screenshot(page, "http://localhost:5173/analytics", os.path.join(output_dir, "analytics-page.png"))

            browser.close()
            print("Browser closed", flush=True)

    except Exception as e:
        print(f"An error occurred: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return False

    return True

if __name__ == "__main__":
    if main():
        print("Script completed successfully.")
        sys.exit(0)
    else:
        print("Script failed.")
        sys.exit(1)
