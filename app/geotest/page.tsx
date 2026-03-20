'use client'

import { useState } from "react"

export default function ActivityFinder() {
  const [coords, setCoords] = useState<{ lat: number, long: number } | null>(null)
  const [places, setPlaces] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const [budget, setBudget] = useState(1000)
  const [likes, setLikes] = useState("")
  const [dislikes, setDislikes] = useState("")

  const getLocation = () => {
    if (!navigator.geolocation) return alert("Geolocation not supported")
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, long: pos.coords.longitude }),
      () => alert("Location permission denied")
    )
  }

  const searchActivities = async () => {
    if (!coords) return alert("Please get your location first!")
    setLoading(true)
    setPlaces([])

    try {
      // Swapping food categories for "Hangout" categories
      const categories = [
        "entertainment.culture",      // Theaters, Museums
        "entertainment.zoo",          // Zoos, Aquariums
        "entertainment.theme_park",   // Fun fairs
        "entertainment.cinema",       // Movies
        "leisure.park",               // Public parks
        "leisure.playground",         // Play areas
        "leisure.spa",                // Relaxation
        "sport.fitness",              // Gyms/Yoga
        "sport.swimming_pool",        // Pools
        "tourism.attraction",         // Sightseeing
        "commercial.shopping_mall"    // Hangout at malls
      ].join(",")

      const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${coords.long},${coords.lat},5000&limit=50&sort=distance&apiKey=${process.env.NEXT_PUBLIC_GEOAPIFY_KEY}`

      const res = await fetch(url)
      const data = await res.json()
      const rawResults = data.features || []

      // --- FILTERS ---
      const dislikeArray = dislikes.toLowerCase().split(',').map(s => s.trim()).filter(s => s !== "")
      
      let filtered = rawResults.filter((p: any) => {
        const name = p.properties.name?.toLowerCase() || ""
        const cats = p.properties.categories?.join(" ").toLowerCase() || ""
        return !dislikeArray.some(d => name.includes(d) || cats.includes(d))
      })

      // --- ACTIVITY BUDGET LOGIC ---
      let finalResults = filtered.filter((p: any) => {
        const cats = p.properties.categories || []
        
        // Low budget: Focus on Parks and Public Areas (usually free)
        if (budget < 500) {
          return cats.includes("leisure.park") || cats.includes("leisure.playground") || cats.includes("tourism.attraction")
        }
        
        // Mid budget: Add Malls, Cinemas, Museums
        if (budget < 1500) {
          return !cats.includes("entertainment.theme_park") // Theme parks are usually pricey
        }

        return true
      })

      if (finalResults.length === 0) finalResults = filtered
      setPlaces(finalResults.slice(0, 20))

    } catch (err) {
      console.error(err)
      alert("Error finding activities")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: "40px", color: "white", background: "#0f172a", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: "bold", marginBottom: "20px" }}>
        Hangout & Activity Finder 🎡
      </h1>

      <div style={{ display: "grid", gap: "15px", maxWidth: "500px", marginBottom: "40px", background: "#1e293b", padding: "20px", borderRadius: "16px" }}>
        <button onClick={getLocation} style={{ padding: "12px", borderRadius: "8px", border: "none", background: "#3b82f6", color: "white", cursor: "pointer", fontWeight: "bold" }}>
          {coords ? "📍 Ready to Explore" : "1. Detect My Location"}
        </button>

        <label style={{ fontSize: "14px" }}>Activity Budget: <b>₹{budget}</b></label>
        <input type="range" min="0" max="5000" step="100" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />

        <input placeholder="I Like (e.g. Park, Bowling, Art)" value={likes} onChange={(e) => setLikes(e.target.value)} style={{ padding: "10px", borderRadius: "8px", background: "#0f172a", border: "1px solid #334155", color: "white" }} />
        
        <input placeholder="I Dislike (e.g. Crowds, Mall)" value={dislikes} onChange={(e) => setDislikes(e.target.value)} style={{ padding: "10px", borderRadius: "8px", background: "#0f172a", border: "1px solid #334155", color: "white" }} />

        <button onClick={searchActivities} disabled={loading} style={{ padding: "15px", borderRadius: "8px", border: "none", background: "#10b981", color: "white", fontWeight: "bold", cursor: "pointer" }}>
          {loading ? "SCOUTING..." : "2. FIND THINGS TO DO"}
        </button>
      </div>

      <div style={{ display: "grid", gap: "20px" }}>
        {places.map((p, i) => {
          const prop = p.properties;
          const lat = p.geometry.coordinates[1];
          const lon = p.geometry.coordinates[0];
          const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

          return (
            <div key={i} style={{ padding: "20px", background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: "0 0 5px 0", color: "#f8fafc" }}>{prop.name || "Cool Hangout Spot"}</h3>
                <p style={{ margin: "0", fontSize: "13px", color: "#94a3b8", textTransform: "capitalize" }}>
                  {prop.categories?.[0].split('.').pop()?.replace('_', ' ')} • {Math.round(prop.distance)}m away
                </p>
                <div style={{ marginTop: "10px" }}>
                  {prop.categories?.slice(0, 3).map((cat: string) => (
                    <span key={cat} style={{ fontSize: "10px", background: "#334155", padding: "2px 6px", borderRadius: "4px", marginRight: "5px", color: "#cbd5e1" }}>
                      #{cat.split('.').pop()}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ marginLeft: "20px" }}>
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", background: "#3b82f6", color: "white", padding: "10px 15px", borderRadius: "8px", fontSize: "14px", fontWeight: "bold" }}>
                  MAP
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  )
}