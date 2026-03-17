---
name: google-cloud-deploy
description: Specialized skill for deploying Smart Door Lock services to Google Cloud Run in asia-south1.
---
# Google Cloud Deploy Skill

This skill automates the deployment of the Smart Door Lock system to Google Cloud Run (Mumbai region).

## Prerequisites
- gcloud CLI installed and authenticated (`gcloud auth login`)
- Billing enabled for the project `auralock-system-2026`

## Deployment Commands

### 1. Deploy AI Engine (Edge)
```powershell
& "C:\Users\abrbh\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run deploy smart-door-edge --source ./edge --platform managed --region asia-south1 --allow-unauthenticated --port 8001 --memory 2Gi --cpu 1 --timeout 600 --set-env-vars "SUPABASE_URL=https://wdtizlzfsijikcejerwq.supabase.co,SUPABASE_KEY=sb_publishable_mMAzoDNSv_f4SHubPuVxUg_3Xr0KbzQ,GOOGLE_API_KEY=AIzaSyDIZBzXv_wE-GywDh5T2ll4-bji5hr2QQM" --quiet
```

### 2. Deploy Backend
```powershell
& "C:\Users\abrbh\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run deploy smart-door-backend --source ./backend --platform managed --region asia-south1 --allow-unauthenticated --port 8000 --memory 1Gi --cpu 1 --set-env-vars "ADMIN_EMAIL=5089shivkumar@gmail.com,ADMIN_PASSWORD=Admin@123,JWT_SECRET=a78b3efb-45e3-4e46-b52a-19c6b6d40bf2,SUPABASE_URL=https://wdtizlzfsijikcejerwq.supabase.co,SUPABASE_KEY=sb_publishable_mMAzoDNSv_f4SHubPuVxUg_3Xr0KbzQ" --quiet
```

## Logs and Monitoring
- View builds: `gcloud builds list`
- View service logs: `gcloud run logs read smart-door-edge`