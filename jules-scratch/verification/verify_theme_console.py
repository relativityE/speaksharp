from playwright.sync_api import sync_playwright

def verify_theme_console():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()

        console_messages = []
        page.on("console", lambda msg: console_messages.append(msg.text))

        try:
            page.goto("http://localhost:5173/")
            page.wait_for_timeout(3000) # Wait for page to load
        except Exception as e:
            print(f"ERROR: Failed to load page: {e}")
            browser.close()
            return

        print("--- Console Messages ---")
        if console_messages:
            for msg in console_messages:
                print(msg)
        else:
            print("No console messages.")
        print("------------------------")

        # Check for critical errors
        has_errors = any("error" in msg.lower() for msg in console_messages)
        if has_errors:
            print("\nERROR: Critical error found in console logs.")
        else:
            print("\nSUCCESS: No critical errors found in console logs.")

        browser.close()

if __name__ == "__main__":
    verify_theme_console()