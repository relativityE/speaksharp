from playwright.sync_api import sync_playwright, expect

def verify_homepage_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        # 1. Navigate to the app, but don't wait for network idle
        try:
            page.goto("http://localhost:5173/", wait_until="domcontentloaded", timeout=15000)
        except Exception as e:
            print(f"Navigation event failed (but continuing): {str(e)}")

        # 2. Verify the new tagline with a more specific selector
        hero_section = page.locator("section").first
        tagline = hero_section.get_by_text("Speaksharp")
        expect(tagline).to_be_visible(timeout=10000)

        # 3. Verify the disabled "Analytics" link
        header = page.locator("header")
        analytics_link = header.get_by_text("Analytics")
        expect(analytics_link).to_have_class(
            "flex items-center px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors opacity-50 pointer-events-none"
        )

        # 4. Take a screenshot
        page.screenshot(path="jules-scratch/verification/final_changes.png")

        browser.close()

if __name__ == "__main__":
    verify_homepage_changes()
