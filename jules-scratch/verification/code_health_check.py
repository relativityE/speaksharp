import os
import re
import json

def analyze_code_health():
    results = {"issues": [], "stats": {}}

    # Check main app files exist
    critical_files = [
        "src/main.jsx", "src/main.tsx",
        "src/App.jsx", "src/App.tsx",
        "index.html"
    ]

    results["critical_files"] = {}
    for file in critical_files:
        if os.path.exists(file):
            results["critical_files"][file] = "exists"
            try:
                with open(file, "r") as f:
                    content = f.read()
                    results["critical_files"][file] = {
                        "exists": True,
                        "size": len(content),
                        "lines": len(content.split('\n'))
                    }
            except Exception as e:
                results["critical_files"][file] = {"error": str(e)}
        else:
            results["critical_files"][file] = "missing"
            results["issues"].append(f"Critical file missing: {file}")

    # Check for common error patterns in src files
    src_files = []
    for root, dirs, files in os.walk("src"):
        for file in files:
            if file.endswith(('.jsx', '.tsx', '.js', '.ts')):
                src_files.append(os.path.join(root, file))

    results["src_files_count"] = len(src_files)

    # Analyze imports and exports
    import_issues = []
    for file_path in src_files[:10]:  # Limit to prevent timeout
        try:
            with open(file_path, "r") as f:
                content = f.read()

                # Check for common issues
                if "import" in content and "from" not in content:
                    import_issues.append(f"Malformed imports in {file_path}")

                # Check for syntax errors (basic)
                if content.count('{') != content.count('}'):
                    import_issues.append(f"Unbalanced braces in {file_path}")

        except Exception as e:
            import_issues.append(f"Cannot read {file_path}: {str(e)}")

    results["import_issues"] = import_issues

    print(json.dumps(results, indent=2))
    return results

if __name__ == "__main__":
    analyze_code_health()
