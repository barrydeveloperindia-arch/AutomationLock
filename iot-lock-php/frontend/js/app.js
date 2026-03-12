// AuraLock - Dashbord Logic

document.addEventListener('DOMContentLoaded', () => {
    const deviceGrid = document.getElementById('deviceGrid');
    const totalDevicesEl = document.getElementById('totalDevices');
    const onlineDevicesEl = document.getElementById('onlineDevices');
    const addDeviceBtn = document.getElementById('addDeviceBtn');
    const addModal = document.getElementById('addModal');
    const closeModal = document.querySelector('.close');
    const refreshIdBtn = document.getElementById('refreshId');
    const saveDeviceBtn = document.getElementById('saveDevice');
    const newDeviceIdEl = document.getElementById('newDeviceId');
    const deviceNameInput = document.getElementById('deviceName');
    const deviceIpInput = document.getElementById('deviceIp');
    const devicePortInput = document.getElementById('devicePort');
    const testConnectionBtn = document.getElementById('testConnection');
    const connectionStatusEl = document.getElementById('connectionStatus');

    // --- State & Polling ---
    let devices = [];

    const fetchDevices = async () => {
        try {
            const res = await fetch('../backend/api/get_devices.php');
            const data = await res.json();
            if (data.success) {
                devices = data.devices;
                renderDevices();
                updateStats();
            }
        } catch (err) {
            console.error('Fetch error:', err);
        }
    };

    const updateStats = () => {
        totalDevicesEl.textContent = devices.length;
        const onlineCount = devices.filter(d => d.status === 'Online').length;
        onlineDevicesEl.textContent = onlineCount;
    };

    const checkLiveHealth = async () => {
        const promises = devices.map(async (device) => {
            const card = document.querySelector(`.device-card[data-id="${device.device_unique_id}"]`);
            const statusPill = card.querySelector('.status-pill');
            const unlockBtn = card.querySelector('.btn-unlock');

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                await fetch(`http://${device.ip_address}:${device.port}/status`, { mode: 'no-cors', signal: controller.signal });

                statusPill.className = 'status-pill Online';
                statusPill.innerHTML = '<div class="dot"></div> Online';
                unlockBtn.disabled = false;
                device.status = 'Online';
            } catch (e) {
                statusPill.className = 'status-pill Offline';
                statusPill.innerHTML = '<div class="dot"></div> Offline';
                unlockBtn.disabled = true;
                device.status = 'Offline';
            }
        });
        await Promise.all(promises);
        updateStats();
    };

    const renderDevices = () => {
        if (devices.length === 0) {
            deviceGrid.innerHTML = '<div class="empty">No hardware registered. Click "Add Hardware" to start.</div>';
            return;
        }

        deviceGrid.innerHTML = devices.map(device => `
            <div class="device-card" data-id="${device.device_unique_id}">
                <div class="status-pill ${device.status}">
                    <div class="dot"></div>
                    ${device.status}
                </div>
                <div class="card-header">
                    <i class="ri-router-line"></i>
                    <h3>${device.name || 'Smart Lock'}</h3>
                    <code>ID: ${device.device_unique_id}</code>
                    <p class="device-ip">Address: ${device.ip_address}:${device.port}</p>
                </div>
                <button class="btn-unlock" onclick="triggerHardwareUnlock('${device.ip_address}', '${device.port}', '${device.device_unique_id}')">
                    <i class="ri-lock-unlock-line"></i> Unlock Door
                </button>
            </div>
        `).join('');
    };

    // --- Actions ---
    window.triggerHardwareUnlock = async (ip, port, id) => {
        const url = `http://${ip}:${port}/unlock`;
        const btn = document.querySelector(`.device-card[data-id="${id}"] .btn-unlock`);

        try {
            btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Pulsing...';
            btn.disabled = true;

            const res = await fetch(url, { mode: 'no-cors' }); // no-cors for simple trigger

            setTimeout(() => {
                btn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Unlocked';
                setTimeout(() => {
                    btn.innerHTML = '<i class="ri-lock-unlock-line"></i> Unlock Door';
                    btn.disabled = false;
                }, 3000);
            }, 800);
        } catch (err) {
            alert('Hardware connection failed at ' + url);
            btn.innerHTML = '<i class="ri-lock-unlock-line"></i> Unlock Door';
            btn.disabled = false;
        }
    };

    // --- Modal Management ---
    addDeviceBtn.onclick = () => {
        addModal.style.display = 'flex';
        generateNewId();
    };

    closeModal.onclick = () => addModal.style.display = 'none';

    const generateNewId = async () => {
        newDeviceIdEl.textContent = 'GENERATING...';
        try {
            const res = await fetch('../backend/api/generate_id.php');
            const data = await res.json();
            newDeviceIdEl.textContent = data.device_id;
        } catch (err) {
            newDeviceIdEl.textContent = 'ERROR';
        }
    };

    refreshIdBtn.onclick = generateNewId;

    testConnectionBtn.onclick = async () => {
        const ip = deviceIpInput.value;
        const port = devicePortInput.value || 80;

        if (!ip) {
            showStatus('Please enter an IP address', 'error');
            return;
        }

        showStatus('Testing...', '');
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            // Using no-cors might not give us status code, but we can detect if it's reachable
            await fetch(`http://${ip}:${port}/`, { mode: 'no-cors', signal: controller.signal });
            showStatus('Device Reachable! Ready to pair.', 'success');
        } catch (err) {
            showStatus('Device Offline or Unreachable on LAN', 'error');
        }
    };

    const showStatus = (msg, type) => {
        connectionStatusEl.textContent = msg;
        connectionStatusEl.className = 'note ' + type;
    };

    saveDeviceBtn.onclick = async () => {
        const id = newDeviceIdEl.textContent;
        const name = deviceNameInput.value || 'Smart Lock';
        const ip = deviceIpInput.value;
        const port = devicePortInput.value || 80;

        if (id === 'ERROR' || id === 'GENERATING...') return;
        if (!ip) {
            showStatus('IP Address is required', 'error');
            return;
        }

        try {
            const res = await fetch('../backend/api/register_device.php', {
                method: 'POST',
                body: JSON.stringify({
                    device_id: id,
                    name: name,
                    ip_address: ip,
                    port: port
                })
            });
            const data = await res.json();
            if (data.success) {
                addModal.style.display = 'none';
                deviceNameInput.value = '';
                deviceIpInput.value = '';
                showStatus('', '');
                fetchDevices();
            } else {
                showStatus(data.message, 'error');
            }
        } catch (err) {
            showStatus('Registration failed', 'error');
        }
    };

    // Initialize
    const init = async () => {
        await fetchDevices();
        checkLiveHealth();
    };

    init();
    setInterval(fetchDevices, 30000); // DB sync every 30s
    setInterval(checkLiveHealth, 10000); // Live health check every 10s
});
