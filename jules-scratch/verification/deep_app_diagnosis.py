from playwright.sync_api import sync_playwright
import json

def diagnose_app_health():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        console_messages = []
        errors = []
        page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
        page.on("pageerror", lambda error: errors.append(str(error)))

        try:
            # Try to navigate, but don't let it block the whole script
            page.goto("http://localhost:5173/", wait_until="domcontentloaded", timeout=15000)
        except Exception as e:
            print(f"Navigation event failed (but continuing): {str(e)}")

        # Wait a fixed amount of time for things to settle
        page.wait_for_timeout(5000)

        # Now, capture the state regardless of navigation success
        page_content = page.content()
        page_title = page.title()
        react_root_exists = page.locator("#root").count() > 0
        react_content_exists = page.locator("#root > *").count() > 0

        diagnosis = {
            "page_title": page_title,
            "page_content_length": len(page_content),
            "react_root_exists": react_root_exists,
            "react_content_exists": react_content_exists,
            "console_messages": console_messages,
            "errors": errors,
        }

        print(json.dumps(diagnosis, indent=2))

        with open("jules-scratch/verification/full_page_content.html", "w") as f:
            f.write(page_content)

        browser.close()

if __name__ == "__main__":
    diagnose_app_health()
