import httpx
import time
import sys

BACKEND_URL = "http://localhost:8000"
ENGINE_URL = "http://localhost:8001"

def test_endpoint(name, url):
    print(f"Testing {name} at {url}...", end=" ", flush=True)
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                print("PASSED")
                return True
            elif resp.status_code == 401:
                print("AUTH REQUIRED (Expected)")
                return True
            else:
                print(f"FAILED (Status {resp.status_code})")
                return False
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return False

def run_tests():
    print("\n--- AuraLock System Health Check ---")
    results = []
    
    # Test Backend Base
    results.append(test_endpoint("Backend Presence", BACKEND_URL))
    
    # Test Users API (The one that was 500ing)
    results.append(test_endpoint("Personnel Management API", f"{BACKEND_URL}/api/users"))
    
    # Test Engine Health
    results.append(test_endpoint("Biometric Engine Health", f"{ENGINE_URL}/health"))
    
    # Test Door Status via Engine
    results.append(test_endpoint("Door Control System", f"{ENGINE_URL}/api/door/status"))
    
    if all(results):
        print("\nSUMMARY: All core systems are OPERATIONAL.")
    else:
        print("\nSUMMARY: Some systems are still experiencing issues.")

if __name__ == "__main__":
    run_tests()
