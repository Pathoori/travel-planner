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
    populateTravelerDropdowns();
}

function _getFilter(id) { const el = $(id); return el ? el.value.toLowerCase().trim() : ''; }
function _getSort(id) { const el = $(id); return el ? el.value : 'added'; }
function _matchesText(query, ...fields) { if (!query) return true; return fields.some(f => (f || '').toLowerCase().includes(query)); }

// ── Populate traveler dropdowns ──
function populateTravelerDropdowns() {
    const names = (_trip.travelers || []).map(t => t.name).filter(Boolean).sort();
    document.querySelectorAll('.traveler-dropdown').forEach(sel => {
        const current = sel.value;
        sel.innerHTML = '<option value="">— Select —</option>' + names.map(n => `<option value="${n}"${n === current ? ' selected' : ''}>${n}</option>`).join('');
    });
}

function renderTravelers() {
    const list = _trip.travelers || [];
    $('traveler-count').textContent = list.length;
    if (!list.length) { $('travelers-list').innerHTML = '<p class="muted">No travelers added yet</p>'; return; }
    const query = _getFilter('filter-travelers');
    const sort = _getSort('sort-travelers');
    // Build indexed list for filtering/sorting
    let items = list.map((t, i) => ({ ...t, _i: i }));
    if (query) items = items.filter(t => _matchesText(query, t.name, t.phone, t.email, t.emergency));
    if (sort === 'name-asc') items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sort === 'name-desc') items.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    else if (sort === 'email-asc') items.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    let html = `<div class="list-header"><span class="filter-count">${items.length} of ${list.length}</span><button class="btn-danger btn-sm" onclick="deleteAll('travelers')">🗑️ Delete All</button></div>`;
    if (!items.length) { html += '<p class="muted">No matching travelers</p>'; $('travelers-list').innerHTML = html; return; }
    html += `<table class="list-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Emergency</th><th></th></tr></thead><tbody>`;
    items.forEach(t => {
        const i = t._i;
        html += `<tr id="row-traveler-${i}">
            <td><strong>${t.name}</strong></td><td>${t.phone || '—'}</td>
            <td>${t.email || '—'}</td><td>${t.emergency || '—'}</td>
            <td class="right row-actions"><button class="btn-edit btn-sm" onclick="editTraveler(${i})">✏️</button><button class="btn-danger btn-sm" onclick="removeTraveler(${i})">✕</button></td>
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
    populateTravelerDropdowns();
    toast('👤 Traveler added!');
}

async function removeTraveler(i) {
    _trip.travelers.splice(i, 1);
    await postJSON('/api/travelers', _trip.travelers);
    renderTravelers();
    populateTravelerDropdowns();
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
    const query = _getFilter('filter-meals');
    const sort = _getSort('sort-meals');
    let items = list.map((m, i) => ({ ...m, _i: i }));
    if (query) items = items.filter(m => _matchesText(query, m.name, m.cook, m.notes));
    if (sort === 'name-asc') items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sort === 'name-desc') items.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    else if (sort === 'cook-asc') items.sort((a, b) => (a.cook || '').localeCompare(b.cook || ''));
    let html = `<div class="list-header"><span class="filter-count">${items.length} of ${list.length}</span><button class="btn-danger btn-sm" onclick="deleteAll('meals')">🗑️ Delete All</button></div>`;
    if (!items.length) { html += '<p class="muted">No matching items</p>'; $('meals-list').innerHTML = html; return; }
    html += `<table class="list-table"><thead><tr><th>Item</th><th>Assigned To</th><th>Notes</th><th></th></tr></thead><tbody>`;
    items.forEach(m => {
        const i = m._i;
        html += `<tr id="row-meal-${i}">
            <td><strong>${m.name}</strong></td>
            <td>${m.cook || '—'}</td>
            <td style="max-width:180px;font-size:.78rem;color:#94a3b8">${m.notes || '—'}</td>
            <td class="right row-actions"><button class="btn-edit btn-sm" onclick="editMeal(${i})">✏️</button><button class="btn-danger btn-sm" onclick="removeMeal(${i})">✕</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    $('meals-list').innerHTML = html;
}

async function addMeal() {
    const name = $('m-name').value.trim();
    if (!name) { toast('Enter item name'); return; }
    _trip.meals.push({ name, cook: $('m-cook').value, notes: $('m-notes').value });
    await postJSON('/api/meals', { meals: _trip.meals });
    $('m-name').value = ''; $('m-cook').value = ''; $('m-notes').value = '';
    renderMeals();
    toast('🍽️ Item added!');
}

async function removeMeal(i) {
    _trip.meals.splice(i, 1);
    await postJSON('/api/meals', { meals: _trip.meals });
    renderMeals();
}

// ══════════════════════════════════════
// SUB-TAB SWITCHING (Essentials)
// ══════════════════════════════════════

function switchSubTab(tab, btn) {
    document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sub-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $('subtab-' + tab).classList.add('active');
}

// ══════════════════════════════════════
// BRING FROM HOME LIST
// ══════════════════════════════════════

function renderHomeList() {
    const list = (_trip.home_list || []);
    $('home-count').textContent = list.length;
    if (!list.length) { $('home-list').innerHTML = '<p class="muted">No items yet</p>'; return; }
    const query = _getFilter('filter-home');
    const sort = _getSort('sort-home');
    const statusFilter = _getSort('filter-home-status');
    let items = list.map((h, i) => ({ ...h, _i: i }));
    if (query) items = items.filter(h => _matchesText(query, h.item, h.qty, h.person, h.notes));
    if (statusFilter === 'packed') items = items.filter(h => h.packed);
    else if (statusFilter === 'unpacked') items = items.filter(h => !h.packed);
    if (sort === 'item-asc') items.sort((a, b) => (a.item || '').localeCompare(b.item || ''));
    else if (sort === 'item-desc') items.sort((a, b) => (b.item || '').localeCompare(a.item || ''));
    else if (sort === 'person-asc') items.sort((a, b) => (a.person || '').localeCompare(b.person || ''));
    let html = `<div class="list-header"><span class="filter-count">${items.length} of ${list.length}</span><button class="btn-danger btn-sm" onclick="deleteAll('home')">🗑️ Delete All</button></div>`;
    if (!items.length) { html += '<p class="muted">No matching items</p>'; $('home-list').innerHTML = html; return; }
    html += `<table class="list-table"><thead><tr><th>✓</th><th>Item</th><th>Qty</th><th>Assigned To</th><th>Notes</th><th></th></tr></thead><tbody>`;
    items.forEach(h => {
        const i = h._i;
        const packed = h.packed;
        html += `<tr id="row-home-${i}" style="${packed ? 'opacity:.55' : ''}">
            <td><button class="check-btn ${packed ? 'checked' : ''}" onclick="toggleHomePacked(${i})">${packed ? '✓' : ''}</button></td>
            <td style="${packed ? 'text-decoration:line-through' : ''}"><strong>${h.item}</strong></td>
            <td>${h.qty || '—'}</td>
            <td>${h.person || '—'}</td>
            <td style="max-width:180px;font-size:.78rem;color:#94a3b8">${h.notes || '—'}</td>
            <td class="right row-actions"><button class="btn-edit btn-sm" onclick="editHomeItem(${i})">✏️</button><button class="btn-danger btn-sm" onclick="removeHomeItem(${i})">✕</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    $('home-list').innerHTML = html;
}

async function addHomeItem() {
    const item = $('h-item').value.trim();
    if (!item) { toast('Enter item name'); return; }
    if (!_trip.home_list) _trip.home_list = [];
    _trip.home_list.push({ item, qty: $('h-qty').value, person: $('h-person').value, notes: $('h-notes').value, packed: false });
    await postJSON('/api/homelist', _trip.home_list);
    $('h-item').value = ''; $('h-qty').value = ''; $('h-person').value = ''; $('h-notes').value = '';
    renderHomeList();
    toast('🏠 Item added!');
}

async function toggleHomePacked(i) {
    _trip.home_list[i].packed = !_trip.home_list[i].packed;
    await postJSON('/api/homelist', _trip.home_list);
    renderHomeList();
}

async function removeHomeItem(i) {
    _trip.home_list.splice(i, 1);
    await postJSON('/api/homelist', _trip.home_list);
    renderHomeList();
}

async function loadHomeList() {
    _trip.home_list = await api('/api/homelist');
    renderHomeList();
}

// ══════════════════════════════════════
// ITEMS TO PURCHASE (GROCERY)
// ══════════════════════════════════════

async function loadGrocery() {
    _trip.grocery_list = await api('/api/grocery');
    renderGrocery();
}

function renderGrocery() {
    const list = _trip.grocery_list || [];
    $('grocery-count').textContent = list.length;
    if (!list.length) { $('grocery-list').innerHTML = '<p class="muted">No items yet</p>'; return; }
    const query = _getFilter('filter-grocery');
    const sort = _getSort('sort-grocery');
    const statusFilter = _getSort('filter-grocery-status');
    let items = list.map((g, i) => ({ ...g, _i: i }));
    if (query) items = items.filter(g => _matchesText(query, g.item, g.qty, g.shopper, g.notes));
    if (statusFilter !== 'all') items = items.filter(g => (g.status || 'Need to Buy') === statusFilter);
    if (sort === 'item-asc') items.sort((a, b) => (a.item || '').localeCompare(b.item || ''));
    else if (sort === 'item-desc') items.sort((a, b) => (b.item || '').localeCompare(a.item || ''));
    else if (sort === 'shopper-asc') items.sort((a, b) => (a.shopper || '').localeCompare(b.shopper || ''));
    else if (sort === 'status-asc') { const ord = {'Need to Buy':0,'Purchased':1}; items.sort((a, b) => (ord[a.status||'Need to Buy']||0) - (ord[b.status||'Need to Buy']||0)); }
    let html = `<div class="list-header"><span class="filter-count">${items.length} of ${list.length}</span><button class="btn-danger btn-sm" onclick="deleteAll('grocery')">🗑️ Delete All</button></div>`;
    if (!items.length) { html += '<p class="muted">No matching items</p>'; $('grocery-list').innerHTML = html; return; }
    html += `<table class="list-table"><thead><tr><th>Item</th><th>Qty</th><th>Shopper</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>`;
    items.forEach(g => {
        const i = g._i;
        const status = g.status || 'Need to Buy';
        const statusClass = { 'Need to Buy': 'status-red', 'Purchased': 'status-green' }[status] || 'status-red';
        const done = status === 'Purchased';
        html += `<tr id="row-grocery-${i}" style="${done ? 'opacity:.55' : ''}">
            <td style="${done ? 'text-decoration:line-through' : ''}"><strong>${g.item}</strong></td>
            <td>${g.qty || '—'}</td>
            <td>${g.shopper || '—'}</td>
            <td><button class="status-badge ${statusClass}" onclick="cycleGroceryStatus(${i})">${status}</button></td>
            <td style="max-width:180px;font-size:.78rem;color:#94a3b8">${g.notes || '—'}</td>
            <td class="right row-actions"><button class="btn-edit btn-sm" onclick="editGrocery(${i})">✏️</button><button class="btn-danger btn-sm" onclick="removeGrocery(${i})">✕</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    $('grocery-list').innerHTML = html;
}

async function addGroceryItem() {
    const item = $('g-item').value.trim();
    if (!item) { toast('Enter item name'); return; }
    const status = $('g-status').value;
    _trip.grocery_list.push({ item, qty: $('g-qty').value, shopper: $('g-shopper').value, status, notes: $('g-notes').value, purchased: status === 'Purchased' });
    await postJSON('/api/grocery', _trip.grocery_list);
    $('g-item').value = ''; $('g-qty').value = ''; $('g-shopper').value = ''; $('g-notes').value = ''; $('g-status').value = 'Need to Buy';
    renderGrocery();
    toast('🛒 Item added!');
}

async function cycleGroceryStatus(i) {
    const order = ['Need to Buy', 'Purchased'];
    const cur = _trip.grocery_list[i].status || 'Need to Buy';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    _trip.grocery_list[i].status = next;
    _trip.grocery_list[i].purchased = next === 'Purchased';
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
    const rawList = _trip.itinerary || [];
    if (!rawList.length) { $('itinerary-list').innerHTML = '<p class="muted">No activities planned yet</p>'; return; }
    const query = _getFilter('filter-itinerary');
    const sort = _getSort('sort-itinerary');
    // Build indexed list for filtering
    let items = rawList.map((it, i) => ({ ...it, _i: i }));
    if (query) items = items.filter(it => _matchesText(query, it.activity, it.notes, it.date, it.time));
    // Sort
    if (sort === 'date-asc') items.sort((a, b) => ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')));
    else if (sort === 'date-desc') items.sort((a, b) => ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || '')));
    else if (sort === 'activity-asc') items.sort((a, b) => (a.activity || '').localeCompare(b.activity || ''));
    let html = `<div class="list-header"><span class="filter-count">${items.length} of ${rawList.length}</span><button class="btn-danger btn-sm" onclick="deleteAll('itinerary')">🗑️ Delete All</button></div>`;
    if (!items.length) { html += '<p class="muted">No matching activities</p>'; $('itinerary-list').innerHTML = html; return; }
    // Group by date
    const byDate = {};
    items.forEach(item => {
        const d = item.date || 'Unscheduled';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(item);
    });
    for (const [date, dayItems] of Object.entries(byDate)) {
        const label = date !== 'Unscheduled' ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Unscheduled';
        html += `<div class="itin-day"><div class="itin-day-header">📅 ${label}</div>`;
        dayItems.forEach(item => {
            const i = item._i;
            html += `<div class="itin-item" id="row-itin-${i}">
                <div class="itin-time">${item.time || '—'}</div>
                <div class="itin-activity">
                    <strong>${item.activity}</strong>
                    ${item.notes ? `<div class="itin-notes">${item.notes}</div>` : ''}
                </div>
                <div class="row-actions"><button class="btn-edit btn-sm" onclick="editItinerary(${i})">✏️</button><button class="btn-danger btn-sm" onclick="removeItinerary(${i})">✕</button></div>
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
        <div class="prog-card clickable" onclick="switchTab('grocery')"><div class="prog-icon pink">🧳</div><div class="prog-data"><div class="prog-num">${((_trip.home_list||[]).length) + groceryTotal}</div><div class="prog-label">Trip Essentials</div></div></div>
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
        csv = 'Item Name,Assigned To,Notes\n';
        (_trip.meals || []).forEach(m => { csv += `${csvEscape(m.name)},${csvEscape(m.cook)},${csvEscape(m.notes)}\n`; });
        filename = 'food-menu.csv';
    } else if (type === 'home') {
        csv = 'Item,Quantity,Assigned To,Notes,Packed\n';
        (_trip.home_list || []).forEach(h => { csv += `${csvEscape(h.item)},${csvEscape(h.qty)},${csvEscape(h.person)},${csvEscape(h.notes)},${h.packed ? 'Yes' : 'No'}\n`; });
        filename = 'bring-from-home.csv';
    } else if (type === 'grocery') {
        csv = 'Item,Quantity,Shopper,Status,Notes\n';
        (_trip.grocery_list || []).forEach(g => { csv += `${csvEscape(g.item)},${csvEscape(g.qty)},${csvEscape(g.shopper)},${csvEscape(g.status || 'Need to Buy')},${csvEscape(g.notes)}\n`; });
        filename = 'items-to-purchase.csv';
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
                if (cols[0]) { _trip.meals.push({ name: cols[0], cook: cols[1] || '', notes: cols[2] || '' }); count++; }
            });
            await postJSON('/api/meals', { meals: _trip.meals });
            renderMeals();
        } else if (type === 'home') {
            if (!_trip.home_list) _trip.home_list = [];
            rows.forEach(line => {
                const cols = parseCSVLine(line);
                if (cols[0]) { _trip.home_list.push({ item: cols[0], qty: cols[1] || '', person: cols[2] || '', notes: cols[3] || '', packed: (cols[4] || '').toLowerCase() === 'yes' }); count++; }
            });
            await postJSON('/api/homelist', _trip.home_list);
            renderHomeList();
        } else if (type === 'grocery') {
            rows.forEach(line => {
                const cols = parseCSVLine(line);
                if (cols[0]) {
                    const st = cols[3] || 'Need to Buy';
                    _trip.grocery_list.push({ item: cols[0], qty: cols[1] || '', shopper: cols[2] || '', status: st, notes: cols[4] || '', purchased: st === 'Purchased' });
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

// ══════════════════════════════════════
// INLINE EDIT (all lists)
// ══════════════════════════════════════

function _inp(val, id) { return `<input class="edit-input" id="${id}" value="${(val||'').replace(/"/g,'&quot;')}">`; }
function _travelerSelect(val, id) {
    const names = (_trip.travelers || []).map(t => t.name).filter(Boolean).sort();
    let opts = `<option value="">— Select —</option>`;
    names.forEach(n => { opts += `<option value="${n}"${n === val ? ' selected' : ''}>${n}</option>`; });
    return `<select class="edit-input" id="${id}">${opts}</select>`;
}

// ── Edit Travelers ──
function editTraveler(i) {
    const t = _trip.travelers[i];
    const row = $('row-traveler-' + i);
    row.innerHTML = `
        <td>${_inp(t.name,'ed-t-name')}</td><td>${_inp(t.phone,'ed-t-phone')}</td>
        <td>${_inp(t.email,'ed-t-email')}</td><td>${_inp(t.emergency,'ed-t-emerg')}</td>
        <td class="right row-actions"><button class="btn-save btn-sm" onclick="saveTravelerEdit(${i})">💾</button><button class="btn-accent btn-sm" onclick="renderTravelers()">✖</button></td>`;
}
async function saveTravelerEdit(i) {
    _trip.travelers[i] = { name: $('ed-t-name').value, phone: $('ed-t-phone').value, email: $('ed-t-email').value, emergency: $('ed-t-emerg').value };
    await postJSON('/api/travelers', _trip.travelers);
    renderTravelers();
    populateTravelerDropdowns();
    toast('✅ Traveler updated');
}

// ── Edit Meals ──
function editMeal(i) {
    const m = _trip.meals[i];
    const row = $('row-meal-' + i);
    row.innerHTML = `
        <td>${_inp(m.name,'ed-m-name')}</td><td>${_travelerSelect(m.cook,'ed-m-cook')}</td>
        <td>${_inp(m.notes,'ed-m-notes')}</td>
        <td class="right row-actions"><button class="btn-save btn-sm" onclick="saveMealEdit(${i})">💾</button><button class="btn-accent btn-sm" onclick="renderMeals()">✖</button></td>`;
}
async function saveMealEdit(i) {
    _trip.meals[i] = { name: $('ed-m-name').value, cook: $('ed-m-cook').value, notes: $('ed-m-notes').value };
    await postJSON('/api/meals', { meals: _trip.meals });
    renderMeals();
    toast('✅ Menu item updated');
}

// ── Edit Home List ──
function editHomeItem(i) {
    const h = _trip.home_list[i];
    const row = $('row-home-' + i);
    row.style.opacity = '1';
    row.innerHTML = `
        <td></td>
        <td>${_inp(h.item,'ed-h-item')}</td><td>${_inp(h.qty,'ed-h-qty')}</td>
        <td>${_travelerSelect(h.person,'ed-h-person')}</td><td>${_inp(h.notes,'ed-h-notes')}</td>
        <td class="right row-actions"><button class="btn-save btn-sm" onclick="saveHomeEdit(${i})">💾</button><button class="btn-accent btn-sm" onclick="renderHomeList()">✖</button></td>`;
}
async function saveHomeEdit(i) {
    _trip.home_list[i] = { ..._trip.home_list[i], item: $('ed-h-item').value, qty: $('ed-h-qty').value, person: $('ed-h-person').value, notes: $('ed-h-notes').value };
    await postJSON('/api/homelist', _trip.home_list);
    renderHomeList();
    toast('✅ Item updated');
}

// ── Edit Grocery ──
function editGrocery(i) {
    const g = _trip.grocery_list[i];
    const st = g.status || 'Need to Buy';
    const row = $('row-grocery-' + i);
    row.style.opacity = '1';
    row.innerHTML = `
        <td>${_inp(g.item,'ed-g-item')}</td><td>${_inp(g.qty,'ed-g-qty')}</td>
        <td>${_travelerSelect(g.shopper,'ed-g-shopper')}</td>
        <td><select class="edit-input" id="ed-g-status"><option ${st==='Need to Buy'?'selected':''}>Need to Buy</option><option ${st==='Purchased'?'selected':''}>Purchased</option></select></td>
        <td>${_inp(g.notes,'ed-g-notes')}</td>
        <td class="right row-actions"><button class="btn-save btn-sm" onclick="saveGroceryEdit(${i})">💾</button><button class="btn-accent btn-sm" onclick="renderGrocery()">✖</button></td>`;
}
async function saveGroceryEdit(i) {
    const st = $('ed-g-status').value;
    _trip.grocery_list[i] = { item: $('ed-g-item').value, qty: $('ed-g-qty').value, shopper: $('ed-g-shopper').value, status: st, notes: $('ed-g-notes').value, purchased: st === 'Purchased' };
    await postJSON('/api/grocery', _trip.grocery_list);
    renderGrocery();
    toast('✅ Item updated');
}

// ── Edit Itinerary ──
function editItinerary(i) {
    const it = _trip.itinerary[i];
    const el = $('row-itin-' + i);
    el.innerHTML = `
        <div><input class="edit-input" type="date" id="ed-i-date" value="${it.date||''}"> <input class="edit-input" type="time" id="ed-i-time" value="${it.time||''}"></div>
        <div style="flex:1"><input class="edit-input" id="ed-i-activity" value="${(it.activity||'').replace(/"/g,'&quot;')}" placeholder="Activity"><input class="edit-input" id="ed-i-notes" value="${(it.notes||'').replace(/"/g,'&quot;')}" placeholder="Notes" style="margin-top:6px"></div>
        <div class="row-actions"><button class="btn-save btn-sm" onclick="saveItineraryEdit(${i})">💾</button><button class="btn-accent btn-sm" onclick="renderItinerary()">✖</button></div>`;
}
async function saveItineraryEdit(i) {
    _trip.itinerary[i] = { date: $('ed-i-date').value, time: $('ed-i-time').value, activity: $('ed-i-activity').value, notes: $('ed-i-notes').value };
    await postJSON('/api/itinerary', _trip.itinerary);
    renderItinerary();
    toast('✅ Activity updated');
}

// ══════════════════════════════════════
// DELETE ALL
// ══════════════════════════════════════

async function deleteAll(type) {
    if (!confirm(`Delete all items from this list?`)) return;
    if (type === 'travelers') {
        _trip.travelers = [];
        await postJSON('/api/travelers', []);
        renderTravelers();
        populateTravelerDropdowns();
    } else if (type === 'meals') {
        _trip.meals = [];
        await postJSON('/api/meals', { meals: [] });
        renderMeals();
    } else if (type === 'home') {
        _trip.home_list = [];
        await postJSON('/api/homelist', []);
        renderHomeList();
    } else if (type === 'grocery') {
        _trip.grocery_list = [];
        await postJSON('/api/grocery', []);
        renderGrocery();
    } else if (type === 'itinerary') {
        _trip.itinerary = [];
        await postJSON('/api/itinerary', []);
        renderItinerary();
    }
    toast('🗑️ All items deleted');
}

// ══════════════════════════════════════
// PHOTO GALLERY
// ══════════════════════════════════════

async function loadGallery() {
    _trip.gallery = await api('/api/gallery');
    renderGallery();
}

function renderGallery() {
    const photos = _trip.gallery || [];
    $('photo-count').textContent = photos.length;
    if (!photos.length) {
        $('photo-gallery').innerHTML = '<p class="muted">No photos yet — upload some memories!</p>';
        return;
    }
    let html = '';
    photos.forEach((p, i) => {
        html += `<div class="photo-card" onclick="openLightbox('${p.url}')">
            <img src="${p.url}" alt="${p.name || 'Trip photo'}" loading="lazy">
            <div class="photo-overlay">
                <span class="photo-caption">${p.name || ''}</span>
                <button class="photo-delete" onclick="event.stopPropagation();deletePhoto(${i})" title="Delete">✕</button>
            </div>
        </div>`;
    });
    $('photo-gallery').innerHTML = html;
}

async function uploadGalleryPhotos(files) {
    if (!files || !files.length) return;
    let count = 0;
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const fd = new FormData();
        fd.append('file', file);
        try {
            const r = await fetch('/api/gallery/upload', { method: 'POST', body: fd });
            const d = await r.json();
            if (d.url) {
                if (!_trip.gallery) _trip.gallery = [];
                _trip.gallery.push({ url: d.url, name: file.name });
                count++;
            }
        } catch (e) { console.error('Upload error:', e); }
    }
    if (count) {
        await postJSON('/api/gallery', _trip.gallery);
        renderGallery();
        toast(`📸 ${count} photo${count > 1 ? 's' : ''} uploaded!`);
    }
}

async function deletePhoto(i) {
    if (!confirm('Delete this photo?')) return;
    _trip.gallery.splice(i, 1);
    await postJSON('/api/gallery', _trip.gallery);
    renderGallery();
    toast('🗑️ Photo deleted');
}

function openLightbox(url) {
    let lb = document.querySelector('.lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.className = 'lightbox';
        lb.innerHTML = '<button class="lightbox-close">✕</button><img>';
        lb.querySelector('.lightbox-close').addEventListener('click', () => lb.classList.remove('active'));
        lb.addEventListener('click', (e) => { if (e.target === lb) lb.classList.remove('active'); });
        document.body.appendChild(lb);
    }
    lb.querySelector('img').src = url;
    lb.classList.add('active');
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', async () => {
    await loadTrip();
    await loadTravelers();
    await loadMeals();
    await loadGrocery();
    await loadHomeList();
    await loadItinerary();
    await loadGallery();
    renderDashboard();

    // Photo gallery upload zone
    const dropZone = $('photo-drop-zone');
    const galleryInput = $('gallery-upload');
    if (dropZone && galleryInput) {
        dropZone.addEventListener('click', () => galleryInput.click());
        galleryInput.addEventListener('change', () => uploadGalleryPhotos(galleryInput.files));
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); uploadGalleryPhotos(e.dataTransfer.files); });
    }
});
