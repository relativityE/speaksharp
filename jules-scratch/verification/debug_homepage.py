from playwright.sync_api import sync_playwright

def debug_homepage_with_screenshot():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to Home Page to take a screenshot...")
        page.goto("http://localhost:5173/")

        # Give the page ample time to load or get stuck
        print("Waiting for 5 seconds before taking screenshot...")
        page.wait_for_timeout(5000)

        page.screenshot(path="jules-scratch/verification/stuck_page.png")
        print("Screenshot of the page saved to stuck_page.png")

        browser.close()

if __name__ == "__main__":
    debug_homepage_with_screenshot()