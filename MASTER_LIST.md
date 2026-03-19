# AuraLock Master Task List & Strategy

**Current Strategy Focus:**
1. Maintain testing exclusively on the Google Cloud Platform (GCP) hosted services.
2. Fully debug and rectify the `Engine Error` plaguing the Facial Recognition Verification API (`smart-door-edge`).
3. Leverage the already successful Fingerprint API functionality via the tablet app as a baseline standard for biometric performance.

---

## 🏗️ Phase 1: Environment Readiness
- [x] Configure Fingerprint biometric unlock flow on the Android APK.
- [x] Extract exact `Engine Error` exception traceback logic locally inside `biometric_api.py` (line 565).
- [ ] Install and configure Google Cloud CLI (`gcloud`) locally for direct Cloud Run diagnostic readouts.
- [ ] Authenticate `gcloud` with the `auralock-system-2026` Google Cloud project.

## 🕵️‍♂️ Phase 2: Face Engine Debugging (GCP)
- [ ] Deploy the modified `biometric_api.py` to the `asia-south1` Cloud Run edge service via authorized Git Push or Cloud Build.
- [ ] Trigger a face verification request from the tablet to recreate the generic "Engine Error".
- [ ] Stream GCP logs using `gcloud run logs read smart-door-edge --region asia-south1` to capture the *exact* Python crash stack trace.
- [ ] Trace and Rectify the root cause (Identify if it's an Out-of-Memory `MemoryError`, shape dimension mismatch on `np.array`, or `dlib` dependency fault).

## ✨ Phase 3: Liveness & End-to-End Success
- [ ] Confirm Gemini 1.5 Liveness Detection passes accurately under the Cloud Run container runtime settings.
- [ ] Verify accurate face vector distances & confidence metrics on a successful verification.
- [ ] Ensure end-to-end execution unlocks the physical door lock via the `runBleCommand` exactly as the fingerprint scanner achieves.

## 🚀 Phase 4: Clean Up & Production Deployment
- [ ] Remove hardcoded test files (`test_biometrics_api.py`, `debug_verify.jpg`, etc.) from the Edge repository.
- [ ] Lock down environment variables inside the GCP Cloud Run console.
- [ ] Monitor real-world latency; ensure the overall "Camera Capture -> Encoded -> Checked -> Unlocked" lifecycle is under 5 seconds.

## 🔩 Phase 5: Mechanical Design & Hardware Housing (SolidWorks/CAD)
- [ ] Design a 3D printable mechanical body to securely house the ESP32-S3 and the 5V single-channel relay circuitry safely.
- [ ] Ensure the housing includes appropriate mounting points for the wall/door frame, and secure wire routing for the 12V external lock loop.
- [ ] Model cutouts for the USB-C `COM` debug port and provide sufficient ventilation to prevent ESP32 thermal throttling.
