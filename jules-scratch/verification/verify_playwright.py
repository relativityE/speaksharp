from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("https://www.google.com")
    page.screenshot(path="jules-scratch/verification/google_screenshot.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
