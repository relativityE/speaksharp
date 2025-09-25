from playwright.sync_api import sync_playwright, Page, expect

def verify_pages():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Home Page
        print("Navigating to Home Page...")
        page.goto("http://localhost:5173/")

        # Wait for a stable element to appear, indicating the page has loaded past any skeletons
        start_button = page.get_by_test_id("start-free-session-button")
        expect(start_button).to_be_visible(timeout=10000) # Increased timeout for stability

        # Now that we know the page is loaded, check for the heading
        expect(page.get_by_role("heading", name="Private Practice. Public Impact!")).to_be_visible()
        page.screenshot(path="jules-scratch/verification/homepage.png")
        print("Screenshot of Home Page saved.")

        # Auth Page
        print("Navigating to Auth Page...")
        page.goto("http://localhost:5173/auth")
        expect(page.get_by_role("heading", name="Sign in to your account")).to_be_visible()
        page.screenshot(path="jules-scratch/verification/authpage.png")
        print("Screenshot of Auth Page saved.")

        # Pricing Page
        print("Navigating to Pricing Page...")
        page.goto("http://localhost:5173/pricing")
        expect(page.get_by_role("heading", name="Choose the right plan for you")).to_be_visible()
        page.screenshot(path="jules-scratch/verification/pricingpage.png")
        print("Screenshot of Pricing Page saved.")

        browser.close()

if __name__ == "__main__":
    verify_pages()