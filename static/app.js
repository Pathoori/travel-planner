// ── Travel Planner — Frontend Logic ──

const $ = id => document.getElementById(id);
let _trip = {};
let _map = null;
let _destMarker = null;
let _nearbyMarkers = [];
let _gApiKey = '';
let _gMapsLoaded = false;

// ── Tab Navigation ──
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    $('tab-' + tab).classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'setup' && _trip.lat) setTimeout(() => initMap(_trip.lat, _trip.lng), 100);
}

// ── Toast ──
function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

// ── API helpers ──
async function api(url, opts) {
    const r = await fetch(url, opts);
    return r.json();
}
function postJSON(url, data) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

// ══════════════════════════════════════
// TRIP SETUP
// ══════════════════════════════════════

async function loadTrip() {
    _trip = await api('/api/trip');
    $('trip-name').value = _trip.name || '';
    $('trip-dest').value = _trip.destination || '';
    $('trip-start').value = _trip.start_date || '';
    $('trip-end').value = _trip.end_date || '';
    if (_trip.group_photo) $('group-photo-preview').innerHTML = `<img src="${_trip.group_photo}">`;
    if (_trip.dest_photo) $('dest-photo-preview').innerHTML = `<img src="${_trip.dest_photo}">`;
    if (_trip.lat) { $('map-card').style.display = ''; initMap(_trip.lat, _trip.lng); }
    renderDashboard();
}

async function saveTrip() {
    const data = {
        name: $('trip-name').value, destination: $('trip-dest').value,
        start_date: $('trip-start').value, end_date: $('trip-end').value,
        lat: _trip.lat, lng: _trip.lng,
    };
    await postJSON('/api/trip', data);
    Object.assign(_trip, data);
    toast('✅ Trip saved!');
}

async function geocodeAddress() {
    const addr = $('trip-dest').value;
    if (!addr) return;
    try {
        const r = await api('/api/geocode?q=' + encodeURIComponent(addr));
        if (r.error) { toast('❌ ' + r.error); return; }
        _trip.lat = r.lat; _trip.lng = r.lng;
        await postJSON('/api/trip', { lat: r.lat, lng: r.lng, destination: addr });
        $('map-card').style.display = '';
        initMap(r.lat, r.lng);
        toast('📍 Location found!');
    } catch (e) { toast('❌ Geocode failed'); }
}

// ── Google Maps loader ──
async function loadGoogleMaps() {
    if (_gMapsLoaded) return Promise.resolve();
    if (!_gApiKey) {
        const cfg = await api('/api/config');
        _gApiKey = cfg.google_api_key || '';
    }
    if (!_gApiKey) { toast('❌ Google Maps API key not set in .env'); return Promise.reject(); }
    return new Promise((resolve, reject) => {
        window._gmapsReady = () => { _gMapsLoaded = true; console.log('Google Maps loaded'); resolve(); };
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${_gApiKey}&libraries=places&callback=_gmapsReady`;
        s.async = true;
        s.defer = true;
        s.onerror = () => { console.error('Google Maps script failed to load'); toast('❌ Google Maps failed to load — enable Maps JavaScript API in Cloud Console'); reject(); };
        document.head.appendChild(s);
    });
}

function initMap(lat, lng) {
    if (!_gMapsLoaded) {
        loadGoogleMaps().then(() => initMap(lat, lng)).catch(() => {
            $('map').innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">❌ Google Maps failed to load.<br><br><span style="color:#94a3b8;font-size:.85rem">Enable <b>Maps JavaScript API</b> at<br><a href="https://console.cloud.google.com/apis/library" target="_blank" style="color:#60a5fa">console.cloud.google.com/apis/library</a></span></div>';
        });
        return;
    }
    const pos = { lat, lng };
    _map = new google.maps.Map($('map'), {
        center: pos, zoom: 14,
        styles: [
            { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
            { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
        ],
        mapTypeControl: false,
        streetViewControl: false,
    });
    if (_destMarker) _destMarker.setMap(null);
    _destMarker = new google.maps.Marker({ position: pos, map: _map, title: '📍 Destination' });
    const iw = new google.maps.InfoWindow({ content: '<b>📍 Destination</b>' });
    iw.open(_map, _destMarker);
}

async function searchNearby(cat, btn) {
    if (!_trip.lat) return;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    $('nearby-results').innerHTML = '<div style="text-align:center;padding:20px;color:#64748b">🔍 Searching...</div>';
    try {
        const results = await api(`/api/nearby?lat=${_trip.lat}&lng=${_trip.lng}&cat=${cat}`);
        if (results.error) { $('nearby-results').innerHTML = `<p style="color:#ef4444">${results.error}</p>`; return; }
        // Clear old markers
        _nearbyMarkers.forEach(m => m.setMap(null));
        _nearbyMarkers = [];
        let html = '';
        if (!results.length) { html = '<div style="padding:16px;color:#64748b;text-align:center">No results found nearby</div>'; }
        results.forEach(r => {
            if (r.lat && r.lng && _map) {
                const m = new google.maps.Marker({
                    position: { lat: r.lat, lng: r.lng },
                    map: _map,
                    title: r.name,
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#0ea5e9', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
                });
                const iw = new google.maps.InfoWindow({ content: `<b>${r.name}</b><br>${r.address || ''}` });
                m.addListener('click', () => iw.open(_map, m));
                _nearbyMarkers.push(m);
            }
            const ratingStr = r.rating ? `⭐ ${r.rating} (${r.total_ratings || 0})` : '';
            const openStr = r.open_now === true ? '🟢 Open' : r.open_now === false ? '🔴 Closed' : '';
            const details = [ratingStr, openStr].filter(Boolean).join(' · ');
            html += `<div class="nearby-item">
                <div>
                    <div class="nearby-name">${r.name}</div>
                    <div class="nearby-detail">${r.address || ''}${details ? ' · ' + details : ''}</div>
                </div>
                <div class="nearby-actions">
                    <button class="btn-accent btn-sm" onclick="savePlace('${esc(r.name)}','${cat}')">⭐ Save</button>
                </div>
            </div>`;
        });
        $('nearby-results').innerHTML = html;
    } catch (e) { $('nearby-results').innerHTML = '<p style="color:#ef4444">Error searching</p>'; }
}

async function savePlace(name, cat) {
    const places = _trip.saved_places || [];
    if (places.find(p => p.name === name)) { toast('Already saved'); return; }
    places.push({ name, category: cat });
    _trip.saved_places = places;
    await postJSON('/api/places', places);
    toast('⭐ Saved!');
}

function esc(s) { return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

// Photo upload
function uploadPhoto(type) {
    const input = $(type + '-photo-input');
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);
    fetch('/api/trip/photo', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(d => {
            if (d.url) {
                $(type + '-photo-preview').innerHTML = `<img src="${d.url}">`;
                _trip[type + '_photo'] = d.url;
                toast('📷 Photo uploaded!');
            }
        });
}
// Click-to-upload
document.addEventListener('DOMContentLoaded', () => {
    $('group-photo-area').addEventListener('click', () => $('group-photo-input').click());
    $('dest-photo-area').addEventListener('click', () => $('dest-photo-input').click());
});

// ══════════════════════════════════════
// TRAVELERS
// ══════════════════════════════════════

async function loadTravelers() {
    _trip.travelers = await api('/api/travelers');
    renderTravelers();
}

function renderTravelers() {
    const list = _trip.travelers || [];
    $('traveler-count').textContent = list.length;
    if (!list.length) { $('travelers-list').innerHTML = '<p class="muted">No travelers added yet</p>'; return; }
    let html = `<table class="list-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Emergency</th><th></th></tr></thead><tbody>`;
    list.forEach((t, i) => {
        html += `<tr>
            <td><strong>${t.name}</strong></td><td>${t.phone || '—'}</td>
            <td>${t.email || '—'}</td><td>${t.emergency || '—'}</td>
            <td class="right"><button class="btn-danger btn-sm" onclick="removeTraveler(${i})">✕</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    $('travelers-list').innerHTML = html;
}

async function addTraveler() {
    const name = $('t-name').value.trim();
    if (!name) { toast('Please enter a name'); return; }
    const travelers = _trip.travelers || [];
    travelers.push({ name, phone: $('t-phone').value, email: $('t-email').value, emergency: $('t-emergency').value });
    await postJSON('/api/travelers', travelers);
    _trip.travelers = travelers;
    $('t-name').value = ''; $('t-phone').value = ''; $('t-email').value = ''; $('t-emergency').value = '';
    renderTravelers();
    toast('👤 Traveler added!');
}

async function removeTraveler(i) {
    _trip.travelers.splice(i, 1);
    await postJSON('/api/travelers', _trip.travelers);
    renderTravelers();
    toast('Traveler removed');
}

// ══════════════════════════════════════
// MEALS & PACKING
// ══════════════════════════════════════

async function loadMeals() {
    const d = await api('/api/meals');
    _trip.meals = d.meals || [];
    renderMeals();
}

function renderMeals() {
    const list = _trip.meals || [];
    $('meals-count').textContent = list.length;
    if (!list.length) { $('meals-list').innerHTML = '<p class="muted">No items yet</p>'; return; }
    let html = `<table class="list-table"><thead><tr><th>Item</th><th>Assigned To</th><th></th></tr></thead><tbody>`;
    list.forEach((m, i) => {
        html += `<tr>
            <td><strong>${m.name}</strong></td>
            <td>${m.cook || '—'}</td>
            <td class="right"><button class="btn-danger btn-sm" onclick="removeMeal(${i})">✕</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    $('meals-list').innerHTML = html;
}

async function addMeal() {
    const name = $('m-name').value.trim();
    if (!name) { toast('Enter item name'); return; }
    _trip.meals.push({ name, cook: $('m-cook').value });
    await postJSON('/api/meals', { meals: _trip.meals });
    $('m-name').value = ''; $('m-cook').value = '';
    renderMeals();
    toast('🍽️ Item added!');
}

async function removeMeal(i) {
    _trip.meals.splice(i, 1);
    await postJSON('/api/meals', { meals: _trip.meals });
    renderMeals();
}

// ══════════════════════════════════════
// GROCERY LIST
// ══════════════════════════════════════

async function loadGrocery() {
    _trip.grocery_list = await api('/api/grocery');
    renderGrocery();
}

function renderGrocery() {
    const list = _trip.grocery_list || [];
    $('grocery-count').textContent = list.length;
    if (!list.length) { $('grocery-list').innerHTML = '<p class="muted">No items yet</p>'; return; }
    let html = `<table class="list-table"><thead><tr><th>✓</th><th>Item</th><th>Qty</th><th>Shopper</th><th></th></tr></thead><tbody>`;
    list.forEach((g, i) => {
        const bought = g.purchased;
        html += `<tr style="${bought ? 'opacity:.5' : ''}">
            <td><button class="check-btn ${bought ? 'checked' : ''}" onclick="toggleGrocery(${i})">${bought ? '✓' : ''}</button></td>
            <td style="${bought ? 'text-decoration:line-through' : ''}"><strong>${g.item}</strong></td>
            <td>${g.qty || '—'}</td>
            <td>${g.shopper || '—'}</td>
            <td class="right"><button class="btn-danger btn-sm" onclick="removeGrocery(${i})">✕</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    $('grocery-list').innerHTML = html;
}

async function addGroceryItem() {
    const item = $('g-item').value.trim();
    if (!item) { toast('Enter item name'); return; }
    _trip.grocery_list.push({ item, qty: $('g-qty').value, shopper: $('g-shopper').value, purchased: false });
    await postJSON('/api/grocery', _trip.grocery_list);
    $('g-item').value = ''; $('g-qty').value = ''; $('g-shopper').value = '';
    renderGrocery();
    toast('🛒 Item added!');
}

async function toggleGrocery(i) {
    _trip.grocery_list[i].purchased = !_trip.grocery_list[i].purchased;
    await postJSON('/api/grocery', _trip.grocery_list);
    renderGrocery();
}

async function removeGrocery(i) {
    _trip.grocery_list.splice(i, 1);
    await postJSON('/api/grocery', _trip.grocery_list);
    renderGrocery();
}

// ══════════════════════════════════════
// ITINERARY
// ══════════════════════════════════════

async function loadItinerary() {
    _trip.itinerary = await api('/api/itinerary');
    renderItinerary();
}

function renderItinerary() {
    const list = (_trip.itinerary || []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    if (!list.length) { $('itinerary-list').innerHTML = '<p class="muted">No activities planned yet</p>'; return; }
    // Group by date
    const byDate = {};
    list.forEach(item => {
        const d = item.date || 'Unscheduled';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(item);
    });
    let html = '';
    for (const [date, items] of Object.entries(byDate)) {
        const label = date !== 'Unscheduled' ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Unscheduled';
        html += `<div class="itin-day"><div class="itin-day-header">📅 ${label}</div>`;
        items.forEach((item, idx) => {
            const globalIdx = list.indexOf(item);
            html += `<div class="itin-item">
                <div class="itin-time">${item.time || '—'}</div>
                <div class="itin-activity">
                    <strong>${item.activity}</strong>
                    ${item.notes ? `<div class="itin-notes">${item.notes}</div>` : ''}
                </div>
                <button class="btn-danger btn-sm" onclick="removeItinerary(${globalIdx})">✕</button>
            </div>`;
        });
        html += '</div>';
    }
    $('itinerary-list').innerHTML = html;
}

async function addItineraryItem() {
    const activity = $('i-activity').value.trim();
    if (!activity) { toast('Enter an activity'); return; }
    _trip.itinerary.push({ date: $('i-date').value, time: $('i-time').value, activity, notes: $('i-notes').value });
    await postJSON('/api/itinerary', _trip.itinerary);
    $('i-activity').value = ''; $('i-notes').value = '';
    renderItinerary();
    toast('📅 Added to itinerary!');
}

async function removeItinerary(i) {
    _trip.itinerary.splice(i, 1);
    await postJSON('/api/itinerary', _trip.itinerary);
    renderItinerary();
}

// ══════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════

function renderDashboard() {
    // ── Hero Banner ──
    const heroBg = $('hero-bg');
    if (_trip.dest_photo) {
        heroBg.style.backgroundImage = `url(${_trip.dest_photo})`;
        heroBg.style.backgroundSize = 'cover';
        heroBg.style.backgroundPosition = 'center';
    }
    const groupPhoto = $('hero-group-photo');
    groupPhoto.innerHTML = _trip.group_photo
        ? `<img src="${_trip.group_photo}">`
        : '<span>👥</span>';

    const heroText = $('hero-text');
    if (_trip.name) {
        const start = _trip.start_date ? new Date(_trip.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
        const end = _trip.end_date ? new Date(_trip.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
        const dateStr = start && end ? `📆 ${start} — ${end}` : '';
        heroText.innerHTML = `
            <h1 class="hero-title">${_trip.name}</h1>
            <p class="hero-subtitle">📍 ${_trip.destination || 'No destination set'}${dateStr ? '<br>' + dateStr : ''}</p>`;
    } else {
        heroText.innerHTML = `
            <h1 class="hero-title">Your Next Adventure</h1>
            <p class="hero-subtitle">Head to <strong>Trip Setup</strong> to start planning</p>`;
    }

    // ── Progress Grid ──
    const travelers = (_trip.travelers || []).length;
    const meals = (_trip.meals || []).length;
    const groceryBought = (_trip.grocery_list || []).filter(g => g.purchased).length;
    const groceryTotal = (_trip.grocery_list || []).length;
    const activities = (_trip.itinerary || []).length;
    const savedPlaces = (_trip.saved_places || []).length;

    $('progress-grid').innerHTML = `
        <div class="prog-card clickable" onclick="switchTab('travelers')"><div class="prog-icon cyan">👥</div><div class="prog-data"><div class="prog-num">${travelers}</div><div class="prog-label">Travelers</div></div></div>
        <div class="prog-card clickable" onclick="switchTab('meals')"><div class="prog-icon orange">🍽️</div><div class="prog-data"><div class="prog-num">${meals}</div><div class="prog-label">Food Menu</div></div></div>
        <div class="prog-card clickable" onclick="switchTab('grocery')"><div class="prog-icon pink">🛒</div><div class="prog-data"><div class="prog-num">${groceryBought} / ${groceryTotal}</div><div class="prog-label">Grocery Bought</div></div></div>
        <div class="prog-card clickable" onclick="switchTab('itinerary')"><div class="prog-icon purple">📅</div><div class="prog-data"><div class="prog-num">${activities}</div><div class="prog-label">Activities</div></div></div>
        <div class="prog-card clickable" onclick="switchTab('setup')"><div class="prog-icon blue">⭐</div><div class="prog-data"><div class="prog-num">${savedPlaces}</div><div class="prog-label">Saved Places</div></div></div>
    `;
}

// ══════════════════════════════════════
// CSV DOWNLOAD / UPLOAD
// ══════════════════════════════════════

function csvEscape(val) {
    val = String(val || '');
    if (val.includes(',') || val.includes('"') || val.includes('\n')) return '"' + val.replace(/"/g, '""') + '"';
    return val;
}

function downloadCSV(type) {
    let csv = '', filename = '';
    if (type === 'meals') {
        csv = 'Item Name,Assigned To\n';
        (_trip.meals || []).forEach(m => { csv += `${csvEscape(m.name)},${csvEscape(m.cook)}\n`; });
        filename = 'food-menu.csv';
    } else if (type === 'grocery') {
        csv = 'Item,Quantity,Shopper,Purchased\n';
        (_trip.grocery_list || []).forEach(g => { csv += `${csvEscape(g.item)},${csvEscape(g.qty)},${csvEscape(g.shopper)},${g.purchased ? 'Yes' : 'No'}\n`; });
        filename = 'grocery-list.csv';
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('⬇️ Downloaded ' + filename);
}

function uploadCSV(type, input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const lines = e.target.result.split('\n').filter(l => l.trim());
        if (lines.length < 2) { toast('❌ CSV is empty or has no data rows'); input.value = ''; return; }
        // Skip header row
        const rows = lines.slice(1);
        let count = 0;
        if (type === 'meals') {
            rows.forEach(line => {
                const cols = parseCSVLine(line);
                if (cols[0]) { _trip.meals.push({ name: cols[0], cook: cols[1] || '' }); count++; }
            });
            await postJSON('/api/meals', { meals: _trip.meals });
            renderMeals();
        } else if (type === 'grocery') {
            rows.forEach(line => {
                const cols = parseCSVLine(line);
                if (cols[0]) {
                    _trip.grocery_list.push({ item: cols[0], qty: cols[1] || '', shopper: cols[2] || '', purchased: (cols[3] || '').toLowerCase() === 'yes' });
                    count++;
                }
            });
            await postJSON('/api/grocery', _trip.grocery_list);
            renderGrocery();
        }
        input.value = '';
        toast(`⬆️ Imported ${count} items from CSV`);
    };
    reader.readAsText(file);
}

function parseCSVLine(line) {
    const result = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') inQuotes = false;
            else cur += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { result.push(cur.trim()); cur = ''; }
            else cur += ch;
        }
    }
    result.push(cur.trim());
    return result;
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', async () => {
    await loadTrip();
    await loadTravelers();
    await loadMeals();
    await loadGrocery();
    await loadItinerary();
    renderDashboard();
});
