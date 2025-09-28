from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console events and print them
        page.on("console", lambda msg: print(f"BROWSER LOG: {msg.text}"))

        # Navigate to the homepage
        page.goto("http://localhost:5173/")

        # Wait for a moment to ensure all scripts have had a chance to run
        page.wait_for_timeout(5000)

        browser.close()

if __name__ == "__main__":
    run()