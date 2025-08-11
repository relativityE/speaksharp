from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:5173/session")
    page.wait_for_selector("h1")
    page.screenshot(path="jules-scratch/verification/session_page.png")
    browser.close()
