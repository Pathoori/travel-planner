"""
Travel Planner — Flask Backend
Handles trip data persistence, image uploads, and nearby discovery via free APIs.
"""

from flask import Flask, render_template, jsonify, request, send_from_directory
import json, os, uuid, requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload

GOOGLE_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
TRIP_FILE = os.path.join(DATA_DIR, "trip.json")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

TRIP_DEFAULTS = {
    "name": "", "destination": "", "start_date": "", "end_date": "",
    "group_photo": "", "dest_photo": "",
    "lat": None, "lng": None,
    "travelers": [],
    "meals": [],
    "packing_list": [],
    "grocery_list": [],
    "itinerary": [],
    "saved_places": [],
}


def _load():
    try:
        with open(TRIP_FILE) as f:
            return {**TRIP_DEFAULTS, **json.load(f)}
    except Exception:
        return dict(TRIP_DEFAULTS)


def _save(data):
    with open(TRIP_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ── Pages ──

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ── Trip CRUD ──

@app.route("/api/trip", methods=["GET"])
def get_trip():
    return jsonify(_load())


@app.route("/api/trip", methods=["POST"])
def save_trip():
    data = request.get_json()
    trip = _load()
    for key in ("name", "destination", "start_date", "end_date", "lat", "lng"):
        if key in data:
            trip[key] = data[key]
    _save(trip)
    return jsonify({"ok": True})


@app.route("/api/trip/photo", methods=["POST"])
def upload_photo():
    photo_type = request.form.get("type", "group")  # "group" or "dest"
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file"}), 400
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    fname = f"{photo_type}_{uuid.uuid4().hex[:8]}.{ext}"
    file.save(os.path.join(UPLOAD_DIR, fname))
    trip = _load()
    trip[f"{photo_type}_photo"] = f"/uploads/{fname}"
    _save(trip)
    return jsonify({"url": f"/uploads/{fname}"})


# ── Travelers ──

@app.route("/api/travelers", methods=["GET"])
def get_travelers():
    return jsonify(_load().get("travelers", []))


@app.route("/api/travelers", methods=["POST"])
def save_travelers():
    trip = _load()
    trip["travelers"] = request.get_json()
    _save(trip)
    return jsonify({"ok": True})


# ── Meals ──

@app.route("/api/meals", methods=["GET"])
def get_meals():
    trip = _load()
    return jsonify({"meals": trip.get("meals", []), "packing_list": trip.get("packing_list", [])})


@app.route("/api/meals", methods=["POST"])
def save_meals():
    data = request.get_json()
    trip = _load()
    trip["meals"] = data.get("meals", trip.get("meals", []))
    trip["packing_list"] = data.get("packing_list", trip.get("packing_list", []))
    _save(trip)
    return jsonify({"ok": True})


# ── Grocery List ──

@app.route("/api/grocery", methods=["GET"])
def get_grocery():
    return jsonify(_load().get("grocery_list", []))


@app.route("/api/grocery", methods=["POST"])
def save_grocery():
    trip = _load()
    trip["grocery_list"] = request.get_json()
    _save(trip)
    return jsonify({"ok": True})


# ── Itinerary ──

@app.route("/api/itinerary", methods=["GET"])
def get_itinerary():
    return jsonify(_load().get("itinerary", []))


@app.route("/api/itinerary", methods=["POST"])
def save_itinerary():
    trip = _load()
    trip["itinerary"] = request.get_json()
    _save(trip)
    return jsonify({"ok": True})


# ── Saved Places ──

@app.route("/api/places", methods=["GET"])
def get_places():
    return jsonify(_load().get("saved_places", []))


@app.route("/api/places", methods=["POST"])
def save_places():
    trip = _load()
    trip["saved_places"] = request.get_json()
    _save(trip)
    return jsonify({"ok": True})


# ── Google Maps API Key (served to frontend) ──

@app.route("/api/config")
def get_config():
    return jsonify({"google_api_key": GOOGLE_API_KEY})


# ── Geocoding (Google Maps Geocoding API) ──

@app.route("/api/geocode")
def geocode():
    q = request.args.get("q", "")
    if not q:
        return jsonify({"error": "No query"}), 400
    if not GOOGLE_API_KEY:
        return jsonify({"error": "Google Maps API key not configured. Add it to .env file."}), 500
    try:
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": q, "key": GOOGLE_API_KEY},
            timeout=15,
        )
        data = resp.json()
        print(f"[Geocode] query='{q}' status={data.get('status')}")
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return jsonify({
                "lat": loc["lat"],
                "lng": loc["lng"],
                "display": data["results"][0].get("formatted_address", ""),
            })
        elif data.get("status") == "ZERO_RESULTS":
            return jsonify({"error": f"Could not find '{q}'. Try a different address."}), 404
        else:
            return jsonify({"error": f"Google API: {data.get('status', 'Unknown error')}"}), 502
    except requests.exceptions.Timeout:
        return jsonify({"error": "Geocode request timed out — try again"}), 504
    except Exception as e:
        print(f"[Geocode Error] {e}")
        return jsonify({"error": str(e)}), 500


# ── Nearby Search (Google Places API) ──

@app.route("/api/nearby")
def nearby():
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    cat = request.args.get("cat", "restaurant")
    if not lat or not lng:
        return jsonify({"error": "lat/lng required"}), 400
    if not GOOGLE_API_KEY:
        return jsonify({"error": "Google Maps API key not configured"}), 500

    type_map = {
        "restaurant": "restaurant",
        "cafe": "cafe",
        "grocery": "supermarket",
        "attraction": "tourist_attraction",
        "entertainment": "amusement_park|park|stadium",
        "pharmacy": "pharmacy",
        "gas": "gas_station",
        "bakery": "bakery",
        "hotel": "hotel",
        "hiking": "park",
    }
    place_type = type_map.get(cat, "restaurant")

    try:
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
            params={
                "location": f"{lat},{lng}",
                "radius": 16093,
                "type": place_type.split("|")[0],
                "key": GOOGLE_API_KEY,
            },
            timeout=15,
        )
        data = resp.json()
        results = []
        for p in data.get("results", [])[:25]:
            loc = p.get("geometry", {}).get("location", {})
            results.append({
                "name": p.get("name", ""),
                "lat": loc.get("lat"),
                "lng": loc.get("lng"),
                "address": p.get("vicinity", ""),
                "rating": p.get("rating", ""),
                "total_ratings": p.get("user_ratings_total", 0),
                "open_now": p.get("opening_hours", {}).get("open_now", None),
                "price_level": p.get("price_level", ""),
                "category": cat,
            })
        return jsonify(results)
    except Exception as e:
        print(f"[Nearby Error] {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
