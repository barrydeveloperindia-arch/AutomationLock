import io
import asyncio
import subprocess
import signal
import sys
import socket
import time
import os
import numpy as np
import google.generativeai as genai
try:
    from bleak import BleakClient, BleakScanner
    HAS_BLE = True
except ImportError:
    HAS_BLE = False
    print("[WARNING] Bleak not found. BLE features will be disabled.")

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import cv2
import face_recognition
from supabase_client import supabase
from datetime import datetime
import json
import uuid
import os
import httpx

# Disable TensorFlow logging for cleaner output
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

# Port wait logic removed - PM2 handles process lifecycle.

app = FastAPI(title="Smart Door Biometric API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Gemini AI for Liveness Detection
GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    liveness_model = genai.GenerativeModel('gemini-1.5-flash')
else:
    liveness_model = None
    print("⚠️ GOOGLE_API_KEY not found. Liveness detection will be disabled.")

async def check_liveness(image_bytes):
    """Uses Gemini to detect if the subject is a real human or a photo/screen."""
    if not liveness_model:
        return True, "Disabled"
    
    try:
        img = Image.open(io.BytesIO(image_bytes))
        prompt = (
            "Analyze this security camera image. Is this a live, 3D physical human being "
            "standing in front of the camera? Or is it a 2D photograph, a digital screen, "
            "or a mask being held up to the camera? "
            "Reply 'READY' if it is a definite live human. "
            "Reply 'SPOOF' if you detect a screen, photo, or suspicious 2D artifact."
        )
        response = liveness_model.generate_content([prompt, img])
        result = response.text.strip().upper()
        
        if "READY" in result:
            return True, "Live Human Detected"
        else:
            return False, "Potential Spoofing Detected"
    except Exception as e:
        print(f"❌ Gemini Liveness Error: {e}")
        return True, "Error-Skipped" # Fail open for reliability, but log error

@app.on_event("startup")
async def startup_event():
    """Initialize system components and background tasks."""
    print("[STARTUP] Initializing Biometric Engine...")
    
    # 1. Load initial cache from disk immediately
    refresh_in_memory_cache()
    
    # 2. Start background synchronization tasks
    asyncio.create_task(sync_task())
    # asyncio.create_task(ble_status_updater()) # Disabled in cloud - handled by Mobile App
    print("[STARTUP] System ready.")

CACHE_FILE = "face_cache.json"
PENDING_LOGS_FILE = "pending_logs.json"
MODEL_NAME = "face-recognition-default" 
DETECTOR_BACKEND = "opencv" # Faster for real-time door lock response

def load_face_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    return []

def save_face_cache(data):
    with open(CACHE_FILE, "w") as f:
        json.dump(data, f)

# --- Optimized Vector Cache ---
IN_MEMORY_CACHE = []
FACE_VECTORS = np.array([])
FACE_METADATA = []

def refresh_in_memory_cache():
    global IN_MEMORY_CACHE, FACE_VECTORS, FACE_METADATA
    try:
        raw_cache = load_face_cache()
        parsed_metadata = []
        vectors = []
        
        for emp in raw_cache:
            emb = emp.get("face_embedding")
            if isinstance(emb, str):
                try: emb = json.loads(emb)
                except: continue
            
            if emb and isinstance(emb, list) and len(emb) == 128:
                vec = np.array(emb, dtype=np.float32)
                # Ensure unit vector for cosine similarity via dot product
                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec = vec / norm
                
                vectors.append(vec)
                parsed_metadata.append({
                    "id": emp.get("id"),
                    "employee_id": emp.get("employee_id"),
                    "name": emp.get("name"),
                    "role": emp.get("role")
                })
        
        if vectors:
            FACE_VECTORS = np.array(vectors, dtype=np.float32)
            FACE_METADATA = parsed_metadata
            IN_MEMORY_CACHE = raw_cache # Keep for compatibility if needed
            print(f"[CACHE] Optimized cache loaded with {len(FACE_METADATA)} employees.")
        else:
            FACE_VECTORS = np.array([])
            FACE_METADATA = []
            print("[CACHE] Cache is empty.")
            
    except Exception as e:
        print(f"[ERROR] In-memory cache refresh failed: {e}")

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
    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    if not backend_url.startswith("http://") and not backend_url.startswith("https://"):
        backend_url = f"http://{backend_url}"
    
    try:
        async with httpx.AsyncClient() as client:
            print(f"[Attendance] Sending mark request for {employee_id} to {backend_url}...")
            response = await client.post(
                f"{backend_url}/attendance/mark",
                json={
                    "employee_id": employee_id,
                    "method": "face",
                    "device_id": "office_terminal"
                },
                timeout=5.0
            )
            print(f"[Attendance] Service responded: {response.text}")
    except Exception as e:
        print(f"[Attendance] API call failed: {str(e)}")

async def background_log_access(employee_id, status, confidence, device_id):
    """
    Log an access attempt to Supabase immediately.
    """
    log_data = {
        "employee_id": employee_id,
        "status": status,
        "confidence": float(confidence),
        "device_id": device_id,
        "created_at": datetime.utcnow().isoformat(),
        "method": "face"
    }
    try:
        supabase.table("access_logs").insert(log_data).execute()
        print(f"[LOG] Access log synced for {employee_id}")
    except Exception as e:
        err_str = str(e).lower()
        if "method" in err_str:
            # Fallback for missing 'method' column
            try:
                smaller = {k: v for k, v in log_data.items() if k != "method"}
                supabase.table("access_logs").insert(smaller).execute()
                print(f"[LOG] Access log synced (no method) for {employee_id}")
            except Exception as e2:
                print(f"[ERROR] Final logging failure: {e2}")
                queue_pending_log(log_data)
        else:
            print(f"[WARNING] Sync failed, queuing log: {e}")
            queue_pending_log(log_data)

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
                    print(f"Syncing {len(pending)} pending logs to Supabase...")
                    # Try syncing with 'method' first
                    try:
                        supabase.table("access_logs").insert(pending).execute()
                        os.remove(PENDING_LOGS_FILE)
                        print(f"[SUCCESS] {len(pending)} pending logs synced.")
                    except Exception as e:
                        err_str = str(e).lower()
                        if "method" in err_str:
                            clean = [{k: v for k, v in l.items() if k != 'method'} for l in pending]
                            try:
                                supabase.table("access_logs").insert(clean).execute()
                                os.remove(PENDING_LOGS_FILE)
                                print(f"[SUCCESS] {len(pending)} logs synced (fallback mode).")
                            except Exception as e2:
                                print(f"[ERROR] Sync retry failed: {e2}")
                        else:
                            print(f"[ERROR] Sync failed: {e}")
            
            # 2. Refresh Cache from normalized face_templates
            print("[SYNC] Refreshing biometric cache from face_templates...")
            response = supabase.table("face_templates") \
                .select("employee_id, embedding, employees(name, role)") \
                .execute()
            
            if response.data:
                # Transform to the format expected by save_face_cache
                flat_data = []
                for entry in response.data:
                    emp_meta = entry.get("employees", {})
                    flat_data.append({
                        "employee_id": entry.get("employee_id"),
                        "face_embedding": entry.get("embedding"),
                        "name": emp_meta.get("name"),
                        "role": emp_meta.get("role")
                    })
                save_face_cache(flat_data)
                refresh_in_memory_cache()
                print(f"[SUCCESS] Biometric cache refreshed: {len(flat_data)} templates.")

        except Exception as e:
            print(f"[WARNING] Sync failed (likely offline): {str(e)}")

        await asyncio.sleep(60) # Sync every 60 seconds

# --- Environment Loader ---
from dotenv import load_dotenv
# Try loading from local, then parent (for shared config)
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

BLE_MAC = os.getenv("ESP32_BLE_MAC", "58:8C:81:CC:65:29")
CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8"

# --- BLE Operation Lock ---
ble_lock = asyncio.Lock()
_is_locked = True # Persistent state for door control buttons
_last_ble_status = {
    "online": False,
    "rssi": -100,
    "name": "Unknown",
    "timestamp": 0
}

async def ble_status_updater():
    """Background task to keep device status alive with a grace period."""
    if not HAS_BLE:
        print("[BLE] Bluetooth hardware not available in this environment. Status updater disabled.")
        return
    global _last_ble_status
    while True:
        try:
            # We don't use the lock here but check it to avoid interfering with active commands
            if not ble_lock.locked():
                device = await BleakScanner.find_device_by_address(BLE_MAC, timeout=4.0)
                if device:
                    print(f"[BLE] Device {BLE_MAC} found (RSSI: {getattr(device, 'rssi', 'N/A')})")
                    _last_ble_status["online"] = True
                    _last_ble_status["rssi"] = getattr(device, 'rssi', -100)
                    _last_ble_status["name"] = device.name or "Englabs_MD"
                    _last_ble_status["timestamp"] = time.time()
                else:
                    # 20 second grace period to prevent flickering Disconnected state
                    if time.time() - _last_ble_status["timestamp"] > 20:
                        if _last_ble_status["online"]:
                            print(f"[BLE] Device {BLE_MAC} lost (Grace period exceeded)")
                        _last_ble_status["online"] = False
        except Exception as e:
            print(f"[BLE] Background status update failed: {e}")
        await asyncio.sleep(8)

async def run_ble_op(command: str):
    """Internal helper to send a command to the ESP32."""
    if not HAS_BLE:
        return {"success": False, "message": "Bluetooth features are disabled in this environment."}
    async with ble_lock:
        try:
            async with BleakClient(BLE_MAC, timeout=10.0) as client:
                if not client.is_connected:
                    return {"success": False, "message": "Failed to connect to door hardware"}
                await client.write_gatt_char(CHARACTERISTIC_UUID, command.encode(), response=True)
                return {"success": True, "message": f"Command {command} executed"}
        except Exception as e:
            return {"success": False, "message": str(e)}

@app.post("/api/door/unlock")
async def unlock_door_endpoint():
    global _is_locked
    print(f"[BLE] Unlocking door {BLE_MAC}...")
    result = await run_ble_op("ON")
    if result["success"]:
        _is_locked = False
        # Auto-relock logic (7s) in background
        async def relock():
            global _is_locked
            await asyncio.sleep(7)
            print(f"[BLE] Auto-relocking door...")
            await run_ble_op("OFF")
            _is_locked = True
        asyncio.create_task(relock())
    return result

@app.post("/api/door/lock")
async def lock_door_endpoint():
    global _is_locked
    print(f"[BLE] Manual locking door...")
    result = await run_ble_op("OFF")
    if result["success"]:
        _is_locked = True
    return result

@app.get("/api/door/status")
async def door_status_endpoint():
    """Returns the cached BLE status maintained by the background task."""
    return {
        "online": _last_ble_status["online"],
        "isLocked": _is_locked,
        "isConnected": _last_ble_status["online"],
        "mac": BLE_MAC,
        "name": _last_ble_status["name"],
        "rssi": _last_ble_status["rssi"],
        "last_seen": int(time.time() - _last_ble_status["timestamp"]) if _last_ble_status["timestamp"] > 0 else -1
    }

@app.get("/api/door/scan")
async def door_scan_endpoint():
    if not HAS_BLE:
        return {"success": False, "message": "Bluetooth scanning disabled."}
    async with ble_lock: # Prevent conflict with other BLE operations
        devices = await BleakScanner.discover(timeout=5.0)
        return [{
            "name": d.name or "Unknown",
            "address": d.address,
            "rssi": getattr(d, 'rssi', -100)
        } for d in devices]

@app.post("/SCAN")
async def scan_compatibility_endpoint():
    """Compatibility endpoint for backend runBleCommand('SCAN')"""
    devices = await door_scan_endpoint()
    return {"success": True, "devices": devices}

@app.get("/health")
async def health_check():
    return {"status": "ready", "engine": "face-recognition", "model": "HOG/CNN", "timestamp": datetime.utcnow()}

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
        # 1. Read image safely avoiding pure OpenCV PyBind11 Memory Rejections
        import tempfile
        contents = await file.read()
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
            
        try:
            import cv2
            import numpy as np
            cv_img = cv2.imread(tmp_path)
            cv_rgb = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
            frame = np.ascontiguousarray(cv_rgb, dtype=np.uint8)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        # 2. Detect and encode using face-recognition
        try:
            encodings = face_recognition.face_encodings(frame)
            if not encodings:
                return {"success": False, "message": "No face detected.", "error_code": "NO_FACE"}
            encoding_list = encodings[0].tolist()
        except Exception as e:
            return {"success": False, "message": f"Engine Error: {str(e)}", "error_code": "ENGINE_ERROR"}

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
        
        # 5. Save Metadata to Normalized face_templates table
        biometric_data = {
            "employee_id": employeeId,
            "embedding": json.dumps(encoding_list),
            "image_url": image_url
        }

        try:
            supabase.table("face_templates").upsert(biometric_data, on_conflict="employee_id").execute()
            print(f"[SUCCESS] Registered in face_templates.")
        except Exception as db_err:
            print(f"[WARNING] Database registration failed: {str(db_err)}")
            raise HTTPException(status_code=500, detail=f"Database error: {str(db_err)}")

        # 6. Always Update Local Cache
        cache = load_face_cache()
        # Update or append
        updated = False
        local_entry = {
            "employee_id": employeeId,
            "face_embedding": encoding_list,
            "name": name if name else employeeId,
            "role": "employee" # Fallback if metadata refresh hasn't run
        }
        for i, emp in enumerate(cache):
            if emp["employee_id"] == employeeId:
                cache[i] = local_entry
                updated = True
                break
        if not updated:
            cache.append(local_entry)
        save_face_cache(cache)
        refresh_in_memory_cache()
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
    Optimized for <2s response time.
    """
    import time
    t_start = time.time()
    
    try:
        # 1. Image Preprocessing via secure PIL Tempfile bypassing cv2/dlib memory bug
        import tempfile
        contents = await file.read()
        t_read = time.time()
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
            
        try:
            import cv2
            import numpy as np
            cv_img = cv2.imread(tmp_path)
            cv_rgb = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
            frame = np.ascontiguousarray(cv_rgb, dtype=np.uint8)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
        t_preprocess = time.time()

        # 2. Single Embedding Generation
        try:
            live_encodings = face_recognition.face_encodings(frame)
            if not live_encodings:
                return {"success": False, "message": "No face detected."}
            live_encoding = live_encodings[0]
        except Exception as e:
            import traceback
            traceback.print_exc()
            err_msg = str(e)
            try:
                debug_info = f"SHAPE: {getattr(frame, 'shape', type(frame))} | DTYPE: {getattr(frame, 'dtype', type(frame))} | TYPE: {type(frame)} | FLAGS: {str(getattr(frame, 'flags', 'none')).replace(chr(10), ' ')}"
            except Exception as debug_err:
                debug_info = f"DEBUG FAILED: {str(debug_err)}"
            return {"success": False, "message": f"Engine Error: {err_msg} | {debug_info}"}
        
        t_encode = time.time()

        # 3. Vectorized Comparison
        global FACE_VECTORS, FACE_METADATA
        if FACE_VECTORS.size == 0:
            return {"success": False, "message": "No registered users found."}

        # Calculate Euclidean distances
        distances = face_recognition.face_distance(FACE_VECTORS, live_encoding)
        best_match_idx = np.argmin(distances)
        min_distance = float(distances[best_match_idx])
        
        # Convert distance to confidence (threshold for face-recognition is usually 0.6 distance)
        # We'll use 1.0 - distance as a similarity score
        max_similarity = 1.0 - min_distance
        
        t_compare = time.time()

        # 4. Threshold & Ambiguity Logic
        STRICT_THRESHOLD = 0.55 # Typical threshold for face_recognition (1 - 0.45 distance)
        AMBIGUITY_GAP = 0.05
        
        matched_emp = FACE_METADATA[best_match_idx]
        
        # Ambiguity Detection
        is_ambiguous = False
        if len(distances) > 1:
            sorted_distances = np.sort(distances)
            gap = sorted_distances[1] - min_distance # Bigger gap means less ambiguity
            if gap < AMBIGUITY_GAP and min_distance < 0.60:
                is_ambiguous = True
                print(f"[REJECTED] Ambiguity detected! Distance Gap: {gap:.4f} < {AMBIGUITY_GAP}")

        if min_distance > 0.45: # Standard Face Recognition threshold is 0.6, we use 0.45 for STRICTness
            print(f"[DENIED] Low confidence: {matched_emp['employee_id']} | Dist: {min_distance:.4f} > 0.45")
            asyncio.create_task(background_log_access(matched_emp["employee_id"], "failed", max_similarity, "terminal_01"))
            return {
                "success": False, 
                "message": "Unrecognized face.", 
                "error_code": "NOT_RECOGNIZED",
                "confidence": max_similarity
            }
        
        if is_ambiguous:
            asyncio.create_task(background_log_access(matched_emp["employee_id"], "failed", max_similarity, "terminal_01"))
            return {
                "success": False,
                "message": "Ambiguous Match: Multiple users similar.",
                "error_code": "AMBIGUOUS_MATCH",
                "confidence": max_similarity
            }

        # 5. Gemini Liveness Security Check (Anti-Spoofing)
        is_live, liveness_msg = await check_liveness(contents)
        if not is_live:
            print(f"[SECURITY] REJECTED: {liveness_msg} for {matched_emp['employee_id']}")
            asyncio.create_task(background_log_access(matched_emp["employee_id"], "spoof_detected", max_similarity, "terminal_01"))
            return {
                "success": False,
                "message": f"Security Alert: {liveness_msg}",
                "error_code": "SPOOF_DETECTED",
                "confidence": max_similarity
            }

        # Success: Verified
        print(f"[VERIFIED] {matched_emp['employee_id']} | Sim: {max_similarity:.4f} | Liveness: {liveness_msg}")
        asyncio.create_task(mark_attendance_async(matched_emp["employee_id"]))
        asyncio.create_task(background_log_access(matched_emp["employee_id"], "success", max_similarity, "terminal_01"))

        t_end = time.time()
        
        # Latency Logging
        latencies = {
            "read": int((t_read - t_start) * 1000),
            "preprocess": int((t_preprocess - t_read) * 1000),
            "encode": int((t_encode - t_preprocess) * 1000),
            "compare": int((t_compare - t_encode) * 1000),
            "total": int((t_end - t_start) * 1000)
        }
        print(f"[PERF] Performance: {latencies['total']}ms (Enc: {latencies['encode']}ms, Comp: {latencies['compare']}ms)")

        return {
            "success": True, 
            "employee_id": matched_emp["employee_id"],
            "name": matched_emp["name"],
            "confidence": max_similarity,
            "performance": latencies
        }

    except Exception as e:
        import traceback
        error_msg = f"Engine Error: {str(e)}"
        print(f"❌ {error_msg}")
        traceback.print_exc()
        return {"success": False, "message": error_msg, "error_code": "ENGINE_ERROR"}


# ── Biometric Cache Management ─────────────────────────────────────────────────

@app.delete("/api/biometrics/face/{employee_id}")
async def delete_face(employee_id: str):
    """
    Remove a specific employee's face template from local cache and database.
    """
    print(f"[DELETE] Evicting face for: {employee_id}")
    cache = load_face_cache()
    new_cache = [emp for emp in cache if emp.get("employee_id") != employee_id]
    save_face_cache(new_cache)
    refresh_in_memory_cache()

    try:
        supabase.table("face_templates").delete().eq("employee_id", employee_id).execute()
        print(f"[DELETE] Removed from database.")
    except Exception as e:
        print(f"[WARNING] Database removal failed: {str(e)}")

    return {"success": True, "message": f"Face data removed for {employee_id}"}

@app.post("/api/biometrics/cache/rebuild")
async def rebuild_cache():
    """
    Force a full rebuild of face_cache.json from face_templates.
    """
    print("[CACHE] Rebuilding cache from face_templates...")
    try:
        response = supabase.table("face_templates") \
            .select("employee_id, embedding, employees(name, role)") \
            .execute()
        
        flat_data = []
        for entry in response.data:
            emp_meta = entry.get("employees", {})
            flat_data.append({
                "employee_id": entry.get("employee_id"),
                "face_embedding": entry.get("embedding"),
                "name": emp_meta.get("name"),
                "role": emp_meta.get("role")
            })
        
        save_face_cache(flat_data)
        refresh_in_memory_cache()
        return {"success": True, "enrolled_count": len(flat_data)}
    except Exception as e:
        print(f"[ERROR] Rebuild failed: {str(e)}")
        return {"success": False, "message": str(e)}


@app.get("/api/biometrics/cache/status")
async def cache_status():
    """Return current cache contents summary for diagnostics."""
    cache = load_face_cache()
    return {
        "cached_employees": len(cache),
        "entries": [{"employee_id": e.get("employee_id"), "name": e.get("name")} for e in cache]
    }


@app.get("/")
async def root():
    return {"status": "online", "service": "Smart Door Biometric API", "version": "v2.6"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port, timeout_graceful_shutdown=5)
