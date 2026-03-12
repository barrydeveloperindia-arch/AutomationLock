New-NetFirewallRule -DisplayName "AuraLock API" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
