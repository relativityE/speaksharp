import subprocess
import os
import json

def check_build_health():
    results = {}

    # Check if node_modules exists and has content
    results["node_modules_exists"] = os.path.exists("node_modules")
    if results["node_modules_exists"]:
        results["node_modules_size"] = len(os.listdir("node_modules"))

    # Check package.json scripts
    try:
        with open("package.json", "r") as f:
            package_data = json.load(f)
            results["scripts"] = package_data.get("scripts", {})
            results["dependencies_count"] = len(package_data.get("dependencies", {}))
    except Exception as e:
        results["package_json_error"] = str(e)

    # Test build without running
    try:
        build_result = subprocess.run(
            ["pnpm", "run", "build", "--dry-run"],
            capture_output=True,
            text=True,
            timeout=30
        )
        results["build_dry_run"] = {
            "success": build_result.returncode == 0,
            "stdout": build_result.stdout,
            "stderr": build_result.stderr
        }
    except subprocess.TimeoutExpired:
        results["build_dry_run"] = {"error": "Build command timed out"}
    except Exception as e:
        results["build_dry_run"] = {"error": str(e)}

    # Check for common config files
    config_files = ["vite.config.js", "vite.config.ts", "vite.config.mjs"]
    results["config_files"] = {
        file: os.path.exists(file) for file in config_files
    }

    print(json.dumps(results, indent=2))
    return results

if __name__ == "__main__":
    check_build_health()
