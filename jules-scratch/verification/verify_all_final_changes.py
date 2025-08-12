from playwright.sync_api import sync_playwright, expect, Page
import re

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # 1. Verify Landing Page
        page.goto("http://localhost:5173/", timeout=30000)

        # Check tagline font size
        tagline = page.locator("p:has-text('Get real-time feedback')")
        expect(tagline).to_have_attribute("class", re.compile(r"text-2xl"))

        # Check for the new 'View Analytics' link in the header
        analytics_link = page.get_by_role("link", name="View Analytics")
        expect(analytics_link).to_be_visible()

        # Screenshot the landing page
        page.screenshot(path="jules-scratch/verification/final-landing-page.png")

        # 2. Verify Session Page
        page.goto("http://localhost:5173/session", timeout=30000)

        # Check timer status font size
        timer_status = page.locator("div.font-semibold:has-text('SESSION PAUSED')")
        expect(timer_status).to_have_attribute("class", re.compile(r"text-base"))

        # Check filler word counter font size
        filler_word_counter_div = page.locator("div[data-testid='filler-word-counter-um'] > div").first
        expect(filler_word_counter_div).to_have_attribute("class", re.compile(r"text-base"))

        # Screenshot the session page
        page.screenshot(path="jules-scratch/verification/final-session-page-fonts.png")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/final-error.png")
    finally:
        context.close()
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
