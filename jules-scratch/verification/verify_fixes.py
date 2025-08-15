from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Verify Analytics Page Font
        print("Navigating to Analytics page...")
        page.goto("http://localhost:4173/analytics")
        page.wait_for_timeout(2000) # Wait for 2 seconds for the page to render
        page.screenshot(path="jules-scratch/verification/analytics_page.png")
        print("Screenshot of Analytics page taken.")

        # Verify Session Page Layout
        print("Navigating to Session page...")
        page.goto("http://localhost:4173/session")
        page.wait_for_timeout(2000) # Wait for 2 seconds for the page to render
        page.screenshot(path="jules-scratch/verification/session_page.png")
        print("Screenshot of Session page taken.")

        browser.close()
        print("Verification complete.")

if __name__ == '__main__':
    run_verification()
