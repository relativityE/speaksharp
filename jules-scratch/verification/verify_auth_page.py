from playwright.sync_api import sync_playwright, Page, expect

def verify_auth_page(page: Page):
    """
    This script verifies the new design of the Auth page.
    """
    try:
        # 1. Navigate to the Auth page.
        page.goto("http://localhost:5173/auth", wait_until="domcontentloaded")

        # 2. Check if we are still on the auth page.
        expect(page).to_have_url("http://localhost:5173/auth", timeout=5000)

        # 3. Wait for the main card title to be visible.
        expect(page.get_by_role("heading", name="Welcome Back")).to_be_visible(timeout=10000)

        # 4. Take a screenshot.
        page.screenshot(path="jules-scratch/verification/auth_page.png")
        print("Successfully took screenshot of auth page.")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")
        print("Took error screenshot.")
        raise

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create a new context with an empty storage state
        context = browser.new_context(storage_state={"cookies": [], "origins": []})
        page = context.new_page()
        verify_auth_page(page)
        browser.close()
