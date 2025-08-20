from playwright.sync_api import sync_playwright, expect, TimeoutError

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    try:
        page.goto("http://localhost:5173/", timeout=20000)
        # Give the page a moment to settle, then take a screenshot
        page.wait_for_timeout(5000)
        print("Page content:")
        print(page.content())
        page.screenshot(path="jules-scratch/verification/redesign_screenshot.png")
    except Exception as e:
        print(f"An error occurred: {e}")
        # Still try to get content if possible
        try:
            print("Page content on error:")
            print(page.content())
        except Exception as content_error:
            print(f"Could not get page content: {content_error}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
