"""Simple script with top-level statements (no functions or classes)."""

import os
import sys

# Configuration from environment
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
API_URL = os.getenv("API_URL", "http://localhost:8000")

# Parse command line arguments
args = sys.argv[1:]
if not args:
    print("Usage: script.py <command>")
    sys.exit(1)

command = args[0]

# Execute command
if command == "start":
    print(f"Starting application in {'debug' if DEBUG else 'production'} mode")
    print(f"API URL: {API_URL}")
elif command == "stop":
    print("Stopping application")
elif command == "status":
    print("Application status: running")
else:
    print(f"Unknown command: {command}")
    sys.exit(1)

print("Script completed successfully")
