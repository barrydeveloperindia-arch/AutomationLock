import io
import asyncio
import subprocess
import signal
import sys
import socket
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from deepface import DeepFace
from supabase_client import supabase
from datetime import datetime
import json
import uuid
import os
import httpx

# Disable TensorFlow logging for cleaner output
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

# ── Port Wait: Non-destructively wait for port 8001 to become available ────────
def wait_for_port_free(port: int, max_wait: int = 20):
    """
    Wait up to `max_wait` seconds for the port to become available.
    Does NOT kill any process — just waits politely so the previous
    uvicorn instance finishes its graceful shutdown.
    """
    import time
    deadline = time.time() + max_wait
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(('127.0.0.1', port)) != 0:
                print(f"[STARTUP] Port {port} is free — starting uvicorn.")
                return  # Port available
        print(f"[STARTUP] Port {port} still in use, waiting... ({int(deadline - time.time())}s left)")
        time.sleep(2)
    print(f"[STARTUP] Warning: port {port} still occupied after {max_wait}s — proceeding anyway.")

# Wait for port to free naturally (previous PM2 instance graceful shutdown)
wait_for_port_free(8001)

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
MODEL_NAME = "Facenet" # 128-dimensional embedding for compatibility
DETECTOR_BACKEND = "opencv" # Faster for real-time door lock response

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

async def mark_attendance_async(employee_id: str):
    """Notify the attendance service about a successful scan."""
    try:
        async with httpx.AsyncClient() as client:
            print(f"📡 [Attendance] Sending mark request for {employee_id}...")
            response = await client.post(
                "http://localhost:8000/attendance/mark",
                json={
                    "employee_id": employee_id,
                    "method": "face",
                    "device_id": "office_terminal"
                },
                timeout=5.0
            )
            print(f"✅ [Attendance] Service responded: {response.text}")
    except Exception as e:
        print(f"⚠️ [Attendance] API call failed: {str(e)}")

async def sync_task():
    """Background task to sync logs and refresh cache."""
    while True:
        try:
            # 1. Sync Pending Logs (strip any unknown columns before inserting)
            VALID_LOG_COLUMNS = {'employee_id', 'status', 'confidence', 'device_id', 'created_at', 'method'}
            if os.path.exists(PENDING_LOGS_FILE):
                with open(PENDING_LOGS_FILE, "r") as f:
                    try:
                        pending = json.load(f)
                    except:
                        pending = []
                if pending:
                    # Strip unknown columns (e.g. 'metadata' which doesn't exist in schema)
                    clean_pending = [{k: v for k, v in log.items() if k in VALID_LOG_COLUMNS} for log in pending]
                    print(f"Syncing {len(clean_pending)} pending logs to Supabase...")
                    supabase.table("access_logs").insert(clean_pending).execute()
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
    # Warm up the model
    print(f"[STARTUP] Initializing AI Models ({MODEL_NAME})...")
    try:
        DeepFace.build_model(MODEL_NAME)
        # Pre-load detector by running it on a tiny black image
        DeepFace.represent(img_path=np.zeros((100, 100, 3), dtype=np.uint8), model_name=MODEL_NAME, detector_backend=DETECTOR_BACKEND, enforce_detection=False)
        print("[SUCCESS] AI Models & Detector Ready.")
    except Exception as e:
        print(f"[ERROR] Model Init Failed: {str(e)}")
    asyncio.create_task(sync_task())

@app.get("/health")
async def health_check():
    return {"status": "online", "engine": "DeepFace", "model": MODEL_NAME, "timestamp": datetime.utcnow()}

@app.post("/api/biometrics/face/register")
async def register_face(
    employeeId: str = Form(...),
    email: str = Form(...),
    name: str = Form(None),
    re_enroll: str = Form("false"),
    file: UploadFile = File(...)
):
    """
    Register a face encoding for a specific employee.
    Uploads photo to Supabase Storage and metadata to Database.
    """
    print(f"[INFO] Registering face for: {employeeId}")
    
    try:
        # 1. Read image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        frame = np.array(image)

        # 2. Detect and encode using DeepFace
        try:
            objs = DeepFace.represent(
                img_path = frame,
                model_name = MODEL_NAME,
                detector_backend = DETECTOR_BACKEND,
                enforce_detection = True,
                align = True,
                normalization = 'Facenet'
            )
            encoding_list = objs[0]["embedding"]
            # L2 Normalize before storing
            encoding_vec = np.array(encoding_list)
            encoding_list = (encoding_vec / np.linalg.norm(encoding_vec)).tolist()
        except ValueError:
            return {"success": False, "message": "No face detected.", "error_code": "NO_FACE"}

        # 3. Cross-Identity Conflict Guard
        cache = load_face_cache()
        if cache:
            valid_cached = []
            for emp in cache:
                emb = emp.get("face_embedding")
                if isinstance(emb, str):
                    try: emb = json.loads(emb)
                    except: continue
                if emb and isinstance(emb, list) and len(emb) == 128:
                    emp["face_embedding"] = emb
                    valid_cached.append(emp)

            if valid_cached:
                existing_encodings = [np.array(emp["face_embedding"]) for emp in valid_cached]
                # Calculate Euclidean distances
                target = np.array(encoding_list)
                existing_distances = [np.linalg.norm(target - exp) for exp in existing_encodings]
                
                min_conflict_dist = np.min(existing_distances)
                if min_conflict_dist < 0.40:
                    conflict_idx = np.argmin(existing_distances)
                    conflicting_emp = valid_cached[conflict_idx]
                    
                    # Skip conflict if this is a re-enrollment of the SAME employee
                    same_employee = (conflicting_emp.get("employee_id") == employeeId)
                    is_re_enroll = re_enroll.lower() == "true"
                    
                    if same_employee or is_re_enroll:
                        print(f"[INFO] Conflict guard bypassed for re-enrollment of {employeeId}")
                    else:
                        print(f"[REJECTED] Biometric Conflict! Face already registered to: {conflicting_emp['name']}")
                        
                        # Log security alert
                        try:
                            alert_data = {
                                "alert_type": "biometric_conflict",
                                "employee_id": employeeId,
                                "severity": "medium",
                                "details": {
                                    "attempted_id": employeeId,
                                    "conflicting_id": conflicting_emp['employee_id'],
                                    "conflict_name": conflicting_emp['name'],
                                    "distance": float(min_conflict_dist)
                                },
                                "device_id": "face_engine_01"
                            }
                            supabase.table("security_alerts").insert(alert_data).execute()
                        except Exception as alert_err:
                            print(f"[WARNING] Failed to log security alert: {str(alert_err)}")

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
        
        # 5. Save Metadata to Supabase Database
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

        # 6. Always Update Local Cache
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

        # 1. Generate live encoding
        try:
            objs = DeepFace.represent(
                img_path = frame,
                model_name = MODEL_NAME,
                detector_backend = DETECTOR_BACKEND,
                enforce_detection = True,
                align = True,
                normalization = 'Facenet'
            )
            live_encoding = np.array(objs[0]["embedding"])
            # L2 Normalize for consistent Euclidean distance thresholding
            live_encoding = live_encoding / np.linalg.norm(live_encoding)
        except ValueError:
            return {"success": False, "message": "No face detected."}

        # 2. Fetch from cache/Supabase
        employees = []
        # 2. Fetch from fast local cache
        mode = "offline" # Always rely on background sync for speed
        employees = load_face_cache()


        if not employees:
            return {"success": False, "message": "No registered users found in system."}

        # 3. Expert Matching Logic (Euclidean Distance for Facenet)
        # Filter for compatible encodings (128 dims)
        valid_employees = []
        for e in employees:
            embedding = e.get("face_embedding")
            if isinstance(embedding, str):
                try:
                    embedding = json.loads(embedding)
                except:
                    continue
            
            if embedding and isinstance(embedding, list) and len(embedding) == 128:
                e["face_embedding"] = embedding
                valid_employees.append(e)

        if not valid_employees:
            return {"success": False, "message": "No valid biometric records found."}

        known_encodings = []
        for e in valid_employees:
            vec = np.array(e["face_embedding"])
            # Normalize stored vectors in case they were saved unnormalized
            known_encodings.append(vec / np.linalg.norm(vec))
            
        face_distances = [np.linalg.norm(live_encoding - exp) for exp in known_encodings]
        
        best_idx = np.argmin(face_distances)
        min_distance = face_distances[best_idx]
        
        # Facenet Thresholds: 0.40 (Strict) - 0.80 (Resilient for RetinaFace)
        STRICT_THRESHOLD = 0.80 
        GAP_THRESHOLD = 0.10
        
        print(f"\n[INFO] [DeepFace Analysis] Best Match Distance: {min_distance:.4f}")

        # Persistent log for remote debugging
        with open("match_debug.log", "a") as f:
            log_entry = f"{datetime.utcnow().isoformat()} | Dist: {min_distance:.4f} | Result: {'OK' if min_distance <= STRICT_THRESHOLD else 'FAIL'} | ID: {valid_employees[best_idx]['employee_id']}\n"
            f.write(log_entry)

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
            sorted_dist = sorted(face_distances)
            gap = sorted_dist[1] - min_distance
            print(f"[INFO] [Gap Check] Best: {min_distance:.4f} | 2nd Best: {sorted_dist[1]:.4f} | Gap: {gap:.4f}")
            
            if gap < GAP_THRESHOLD:
                print(f"[REJECTED] Ambiguity Detected! Gap {gap:.4f} < {GAP_THRESHOLD}")
                return {
                    "success": False, 
                    "message": "Ambiguous Match: Multiple users similar.", 
                    "error_code": "AMBIGUOUS_MATCH",
                    "id_hint": valid_employees[best_idx]["employee_id"] # Internal hint for backend
                }

        # Success: Best Match Confirmed
        matched_emp = valid_employees[best_idx]
        print(f"[VERIFIED] Match: {matched_emp['employee_id']} | Name: {matched_emp.get('name')}")
        
        # Integrate Attendance API (Fire and forget task)
        asyncio.create_task(mark_attendance_async(matched_emp["employee_id"]))
        print(f"[DEBUG] matched_emp keys: {list(matched_emp.keys())}")

        # Log to Database
        log_data = {
            "employee_id": matched_emp["employee_id"],
            "status": "success",
            "confidence": round(1.0 - (min_distance / 2), 4), # Normalized confidence
            "device_id": "terminal_01",
            "created_at": datetime.utcnow().isoformat()
        }
        
        try:
            if mode == "online": 
                # Attempt insert; if it fails (e.g. missing column), fallback to queue
                try:
                    supabase.table("access_logs").insert(log_data).execute()
                except Exception as db_err:
                    print(f"[WARNING] Database Insert Failed (Check Schema/Columns): {str(db_err)}")
                    queue_pending_log(log_data)
            else: 
                queue_pending_log(log_data)
        except Exception as log_err:
            print(f"[WARNING] Log save error: {str(log_err)}")
            queue_pending_log(log_data)

        return {
            "success": True, 
            "message": f"Verified ({mode})", 
            "employee_id": matched_emp["employee_id"],
            "name": str(matched_emp.get("name") or "Authorized User").strip(),
            "confidence": log_data["confidence"]
        }

    except Exception as e:
        print(f"[ERROR] Verification Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Biometric Cache Management ─────────────────────────────────────────────────

@app.delete("/api/biometrics/face/{employee_id}")
async def delete_face(employee_id: str):
    """
    Remove a specific employee's face embedding from the local cache.
    Called automatically when an employee is deleted from the admin panel.
    """
    print(f"[DELETE] Evicting face cache for: {employee_id}")
    cache = load_face_cache()
    original_length = len(cache)

    # Remove ALL entries matching this employee_id
    new_cache = [emp for emp in cache if emp.get("employee_id") != employee_id]
    removed   = original_length - len(new_cache)

    save_face_cache(new_cache)

    # Also null out face_embedding in Supabase (belt + suspenders)
    try:
        supabase.table("employees").update({"face_embedding": None}).eq("employee_id", employee_id).execute()
        print(f"[DELETE] Nulled face_embedding in Supabase for {employee_id}")
    except Exception as e:
        print(f"[WARNING] Could not null embedding in Supabase (may already be deleted): {str(e)}")

    print(f"[DELETE] Removed {removed} cache entry/entries for {employee_id}. Cache size: {len(new_cache)}")
    return {
        "success": True,
        "message": f"Face data evicted for {employee_id}",
        "entries_removed": removed,
        "cache_size": len(new_cache)
    }


@app.post("/api/biometrics/cache/rebuild")
async def rebuild_cache():
    """
    Force a full rebuild of face_cache.json from Supabase.
    Called after employee deletion to ensure consistency.
    """
    print("[CACHE] Forcing full cache rebuild from Supabase...")
    try:
        response = supabase.table("employees") \
            .select("id, name, employee_id, face_embedding, role") \
            .not_.is_("face_embedding", "null") \
            .execute()
        save_face_cache(response.data)
        print(f"[CACHE] Rebuilt: {len(response.data)} enrolled employees")
        return {
            "success": True,
            "message": "Cache rebuilt from Supabase",
            "enrolled_count": len(response.data)
        }
    except Exception as e:
        print(f"[ERROR] Cache rebuild failed: {str(e)}")
        return {"success": False, "message": f"Rebuild failed: {str(e)}"}


@app.get("/api/biometrics/cache/status")
async def cache_status():
    """Return current cache contents summary for diagnostics."""
    cache = load_face_cache()
    return {
        "cached_employees": len(cache),
        "entries": [{"employee_id": e.get("employee_id"), "name": e.get("name")} for e in cache]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, timeout_graceful_shutdown=5)
