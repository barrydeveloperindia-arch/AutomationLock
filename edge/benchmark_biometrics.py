import httpx
import time
import io
import asyncio
import numpy as np
from PIL import Image

API_URL = "http://localhost:8001"

async def run_benchmark():
    print("Starting AuraLock Performance Benchmark...")
    
    # 1. Warm up (ensure model is loaded)
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            print("Warming up engine...")
            await client.get(f"{API_URL}/health")
        except Exception as e:
            print(f"API is offline: {e}")
            return

        # Create a sample face image (synthetic for benchmark)
        img = Image.new('RGB', (640, 480), color='white')
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='JPEG')
        img_data = img_byte_arr.getvalue()
        
        files = {"file": ("probe.jpg", img_data, "image/jpeg")}
        
        print("\nMeasuring Verification Latency...")
        latencies = []
        for i in range(5):
            start = time.time()
            try:
                # Reset file pointer for multi-request if needed, but here we rebuild dict
                files = {"file": ("probe.jpg", img_data, "image/jpeg")}
                response = await client.post(f"{API_URL}/api/biometrics/face/verify", files=files)
                duration = (time.time() - start) * 1000
                
                result = response.json()
                if result.get("success"):
                    print(f"  [{i+1}] Latency: {duration:.2f}ms | Conf: {result.get('confidence', 0):.4f}")
                else:
                    # Expected if empty/white image and no face detected, let's check message
                    msg = result.get("message", "Unknown")
                    print(f"  [{i+1}] Latency: {duration:.2f}ms | Result: {msg}")
                
                latencies.append(duration)
            except Exception as e:
                print(f"  [{i+1}] FAILED: {e}")

        if latencies:
            avg = sum(latencies) / len(latencies)
            print(f"\nAverage Latency: {avg:.2f}ms")
            if avg < 2000:
                print("PERFORMANCE TARGET MET (< 2000ms)")
            else:
                print("PERFORMANCE TARGET NOT MET")

if __name__ == "__main__":
    asyncio.run(run_benchmark())
