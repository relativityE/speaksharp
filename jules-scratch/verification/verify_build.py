from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console messages
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))

        print("Navigating to the root page...")
        page.goto("http://localhost:5174/")

        print("Waiting for page to settle...")
        page.wait_for_timeout(3000)

        print("Attempting manual import from console...")
        page.evaluate("import('./src/main.jsx').then(m => console.log('Manual import successful:', m)).catch(e => console.error('Manual import failed:', e))")

        print("Waiting for manual import to resolve...")
        page.wait_for_timeout(3000)

        browser.close()
        print("Verification script finished.")

if __name__ == '__main__':
    run_verification()
