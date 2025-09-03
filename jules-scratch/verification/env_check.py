import os
import json
import subprocess

def check_environment():
    results = {}

    # Check Node.js and npm versions
    try:
        node_version = subprocess.check_output(["node", "--version"], text=True).strip()
        npm_version = subprocess.check_output(["npm", "--version"], text=True).strip()
        results["runtime"] = {
            "node_version": node_version,
            "npm_version": npm_version
        }
    except Exception as e:
        results["runtime"] = {"error": str(e)}

    # Check environment variables
    env_vars = {}
    for key, value in os.environ.items():
        if any(prefix in key.upper() for prefix in ['VITE_', 'REACT_', 'SUPABASE_']):
            # Don't expose sensitive values
            env_vars[key] = "SET" if value else "EMPTY"

    results["environment_variables"] = env_vars

    # Check if dev server can start (without blocking)
    try:
        # Just check if the command exists and can be parsed
        help_result = subprocess.run(
            ["pnpm", "run", "dev", "--help"],
            capture_output=True,
            text=True,
            timeout=10
        )
        results["dev_command"] = {
            "exists": help_result.returncode in [0, 1],  # 1 is often normal for --help
            "output": help_result.stdout[:500]  # Truncate output
        }
    except Exception as e:
        results["dev_command"] = {"error": str(e)}

    print(json.dumps(results, indent=2))
    return results

if __name__ == "__main__":
    check_environment()
