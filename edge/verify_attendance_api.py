import asyncio
import httpx

async def test_attendance_mark():
    employee_id = "EMP-961231"
    url = "http://localhost:8000/attendance/mark"
    payload = {
        "employee_id": employee_id,
        "method": "face",
        "device_id": "office_terminal"
    }
    
    print(f"Testing Attendance Mark API at {url}...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=5.0)
            print(f"Response Status: {response.status_code}")
            print(f"Response Text: {response.text}")
    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    asyncio.run(test_attendance_mark())
