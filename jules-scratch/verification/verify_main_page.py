from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the local dev server
        print("Navigating to http://localhost:5173...")
        page.goto("http://localhost:5173", timeout=20000)
        page.wait_for_timeout(2000)

        # Test 1: Verify Tailwind CSS is being processed
        print("Running Diagnostic Test 1: Verifying Tailwind CSS processing...")
        computed_style = page.evaluate("""() => {
            const testDiv = document.createElement('div');
            testDiv.className = 'bg-red-500'; // A simple Tailwind class
            document.body.appendChild(testDiv);
            const style = getComputedStyle(testDiv);
            const bgColor = style.backgroundColor;
            document.body.removeChild(testDiv);
            return bgColor;
        }""")

        print(f"Diagnostic Result: The computed background color for 'bg-red-500' is: {computed_style}")

        expected_color = 'rgb(239, 68, 68)' # This is the RGB for Tailwind's red-500
        if computed_style == expected_color:
            print("Conclusion: SUCCESS! Tailwind CSS is being processed correctly.")
        else:
            print("Conclusion: FAILURE! Tailwind CSS is NOT being processed.")

        browser.close()

if __name__ == "__main__":
    run()
