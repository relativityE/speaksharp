from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        page.goto("http://localhost:5173/")

        start_button = page.get_by_role("button", name="Start Your Free Session")
        expect(start_button).to_be_visible(timeout=10000)
        start_button.click()

        page.wait_for_url("**/session")

        settings_title = page.get_by_role("heading", name="Settings")
        expect(settings_title).to_be_visible(timeout=10000)

        page.screenshot(path="jules-scratch/verification/session_page_fixes.png")
        print("Screenshot saved to jules-scratch/verification/session_page_fixes.png")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error_screenshot.png")
        print("Error screenshot saved to jules-scratch/verification/error_screenshot.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
