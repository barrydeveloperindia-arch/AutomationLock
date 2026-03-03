import io
import asyncio
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import face_recognition
from supabase_client import supabase
from datetime import datetime
import json
import uuid

import os

app = FastAPI(title="Smart Door Biometric API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CACHE_FILE = "face_cache.json"
PENDING_LOGS_FILE = "pending_logs.json"

def load_face_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    return []

def save_face_cache(data):
    with open(CACHE_FILE, "w") as f:
        json.dump(data, f)

def queue_pending_log(log_data):
    logs = []
    if os.path.exists(PENDING_LOGS_FILE):
        with open(PENDING_LOGS_FILE, "r") as f:
            try: logs = json.load(f)
            except: logs = []
    logs.append(log_data)
    with open(PENDING_LOGS_FILE, "w") as f:
        json.dump(logs, f)

async def sync_task():
    """Background task to sync logs and refresh cache."""
    while True:
        try:
            # 1. Sync Pending Logs
            if os.path.exists(PENDING_LOGS_FILE):
                with open(PENDING_LOGS_FILE, "r") as f:
                    pending = json.load(f)
                if pending:
                    print(f"Syncing {len(pending)} pending logs to Supabase...")
                    supabase.table("access_logs").insert(pending).execute()
                    os.remove(PENDING_LOGS_FILE)
            
            # 2. Refresh Cache
            response = supabase.table("employees").select("id, name, employee_id, face_embedding, role").not_.is_("face_embedding", "null").execute()
            save_face_cache(response.data)
            print("[SUCCESS] Face cache refreshed from Supabase.")
            
        except Exception as e:
            print(f"[WARNING] Sync failed (likely offline): {str(e)}")
        
        await asyncio.sleep(300) # Sync every 5 minutes

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(sync_task())

@app.get("/health")
async def health_check():
    return {"status": "online", "timestamp": datetime.utcnow()}

@app.post("/api/biometrics/face/register")
async def register_face(
    employeeId: str = Form(...),
    email: str = Form(...),
    name: str = Form(None),
    file: UploadFile = File(...)
):
    """
    Register a face encoding for a specific employee.
    Uploads photo to Supabase Storage and metadata to Database.
    """
    print(f"📥 Registering face for: {employeeId}")
    
    try:
        # 1. Read and process image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        frame = np.array(image)

        # 2. Detect and encode
        face_locations = face_recognition.face_locations(frame)
        if not face_locations:
            return {"success": False, "message": "No face detected.", "error_code": "NO_FACE"}
        
        encodings = face_recognition.face_encodings(frame, face_locations)
        encoding_list = encodings[0].tolist()

        # 3. Cross-Identity Conflict Guard (Prevent duplicate registration of same person)
        cache = load_face_cache()
        if cache:
            existing_encodings = [np.array(emp["face_embedding"]) for emp in cache]
            existing_distances = face_recognition.face_distance(existing_encodings, np.array(encoding_list))
            
            min_conflict_dist = np.min(existing_distances)
            if min_conflict_dist < 0.35:
                conflict_idx = np.argmin(existing_distances)
                conflicting_emp = cache[conflict_idx]
                print(f"[REJECTED] Biometric Conflict! Face already registered to: {conflicting_emp['name']} ({conflicting_emp['employee_id']})")
                return {
                    "success": False, 
                    "message": f"Biometric Conflict: This person is already registered as {conflicting_emp['name']}.",
                    "conflicting_id": conflicting_emp['employee_id']
                }

        # 4. Upload Image to Supabase Storage
        file_path = f"faces/{employeeId}_{uuid.uuid4().hex[:8]}.jpg"
        image_url = ""
        
        try:
            supabase.storage.from_("biometrics").upload(
                path=file_path,
                file=contents,
                file_options={"content-type": "image/jpeg"}
            )
            image_url = str(supabase.storage.from_("biometrics").get_public_url(file_path))
        except Exception as upload_err:
            print(f"[WARNING] Storage Upload Failed (Offline?): {str(upload_err)}")
        
        # 4. Save Metadata to Supabase Database
        user_data = {
            "name": name if name else employeeId, 
            "email": email,
            "employee_id": employeeId,
            "face_embedding": encoding_list,
            "image_url": image_url,
            "role": "employee"
        }

        try:
            supabase.table("employees").upsert(user_data, on_conflict="employee_id").execute()
            print(f"[SUCCESS] Registered in Cloud.")
        except Exception as db_err:
            print(f"[WARNING] Cloud Registration Failed: {str(db_err)}")

        # 5. Always Update Local Cache
        cache = load_face_cache()
        # Update or append
        updated = False
        for i, emp in enumerate(cache):
            if emp["employee_id"] == employeeId:
                cache[i] = user_data
                updated = True
                break
        if not updated:
            cache.append(user_data)
        save_face_cache(cache)
        print(f"[SUCCESS] Local cache updated for {employeeId}")

        return {
            "success": True, 
            "message": "Face registered successfully.",
            "image_url": image_url,
            "encoding": encoding_list
        }

    except Exception as e:
        print(f"[ERROR] Registration Error: {str(e)}")
        return {"success": False, "message": f"Engine Error: {str(e)}"}

@app.post("/api/biometrics/face/verify")
async def verify_face(file: UploadFile = File(...)):
    """
    Verify a live frame against registered encodings.
    Uses Supabase with automatic local cache fallback.
    """
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        frame = np.array(image)

        face_locations = face_recognition.face_locations(frame)
        if not face_locations:
            return {"success": False, "message": "No face detected."}
        
        live_encoding = face_recognition.face_encodings(frame, face_locations)[0]

        # 3. Fetch from Supabase with Fallback
        employees = []
        mode = "online"
        try:
            response = supabase.table("employees").select("id, name, employee_id, face_embedding, role").not_.is_("face_embedding", "null").execute()
            employees = response.data
            save_face_cache(employees) # Update cache on success
        except Exception as e:
            print(f"[WARNING] Supabase Offline, using local cache: {str(e)}")
            employees = load_face_cache()
            mode = "offline"

        if not employees:
            return {"success": False, "message": "No registered users found in system."}

        # 4. Expert Matching Logic (face_distance Based)
        known_encodings = [np.array(e["face_embedding"]) for e in employees]
        face_distances = face_recognition.face_distance(known_encodings, live_encoding)
        
        # Sort distances to find best and runner-up
        sorted_indices = np.argsort(face_distances)
        best_idx = sorted_indices[0]
        min_distance = face_distances[best_idx]
        
        # Security Thresholds
        STRICT_THRESHOLD = 0.40
        GAP_THRESHOLD = 0.05
        
        print(f"\n[INFO] [Biometric Match Analysis] Best Match Distance: {min_distance:.4f}")

        # Rejection: Above Threshold
        if min_distance > STRICT_THRESHOLD:
            print(f"[REJECTED] Match distance {min_distance:.4f} > Threshold {STRICT_THRESHOLD}")
            return {
                "success": False, 
                "message": "Access Denied: Unrecognized face.", 
                "error_code": "NOT_RECOGNIZED"
            }

        # Rejection: Ambiguous (Gap Check)
        if len(face_distances) > 1:
            second_best_dist = face_distances[sorted_indices[1]]
            gap = second_best_dist - min_distance
            print(f"[INFO] [Gap Check] Best: {min_distance:.4f} | 2nd Best: {second_best_dist:.4f} | Gap: {gap:.4f}")
            
            if gap < GAP_THRESHOLD:
                print(f"[REJECTED] Ambiguity Detected! Gap {gap:.4f} < {GAP_THRESHOLD}")
                return {
                    "success": False, 
                    "message": "Ambiguous Match: Multiple users similar.", 
                    "error_code": "AMBIGUOUS_MATCH",
                    "id_hint": employees[best_idx]["employee_id"] # Internal hint for backend
                }

        # Success: Best Match Confirmed
        matched_emp = employees[best_idx]
        print(f"[VERIFIED] Best match confirmed: {matched_emp['employee_id']}")

        # Log to Database
        log_data = {
            "employee_id": matched_emp["employee_id"],
            "status": "success",
            "confidence": round(1.0 - min_distance, 4),
            "device_id": "terminal_01",
            "metadata": {"mode": mode, "distance": float(min_distance)},
            "created_at": datetime.utcnow().isoformat()
        }

        try:
            if mode == "online":
                supabase.table("access_logs").insert(log_data).execute()
            else:
                queue_pending_log(log_data)
        except Exception as log_err:
            print(f"[WARNING] Log save error: {str(log_err)}")
            queue_pending_log(log_data)

        return {
            "success": True, 
            "message": f"Verified ({mode})", 
            "employee_id": matched_emp["employee_id"],
            "confidence": round(1.0 - min_distance, 4)
        }

    except Exception as e:
        print(f"[ERROR] Verification Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
