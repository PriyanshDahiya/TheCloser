'use client'

import { useState, use, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Groq from "groq-sdk"

const groq = new Groq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
  dangerouslyAllowBrowser: true
})

/* ---------------- 1. TYPES & INTERFACES ---------------- */

interface GeoapifyPlace {
  properties: {
    name: string;
    categories: string[];
    distance: number;
    lat: number;
    lon: number;
    place_id: string;
  };
  geometry: {
    coordinates: [number, number];
  };
}

/* ---------------- 2. TARGETED FOOD FETCHER ---------------- */

async function fetchMeetupPlaces(lat: number, long: number): Promise<GeoapifyPlace[]> {
  const categories = "catering.cafe,catering.restaurant,catering.pub,catering.bar,catering.fast_food.pizza,catering.fast_food.burger"
  const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${long},${lat},5000&limit=50&sort=distance&apiKey=${process.env.NEXT_PUBLIC_GEOAPIFY_KEY}`

  const res = await fetch(url)
  const data = await res.json()
  let results: GeoapifyPlace[] = data.features || []

  const bannedWords = ["canteen", "food court", "mess", "stall", "tiffin", "dhaba"]
  results = results.filter((p: GeoapifyPlace) => {
    const name = p.properties.name?.toLowerCase() || ""
    return name.length > 0 && !bannedWords.some(w => name.includes(w))
  })

  const bannedChains = ["mcdonald", "pizza hut", "dominos", "subway", "kfc", "burger king", "cafe coffee day", "bikaner", "starbucks"]
  let filtered = results.filter((p: GeoapifyPlace) => {
    const name = p.properties.name?.toLowerCase() || ""
    return !bannedChains.some(c => name.includes(c))
  })

  if (filtered.length === 0) filtered = results
  
  const priority = ["catering.cafe", "catering.restaurant", "catering.pub"]
  filtered.sort((a: GeoapifyPlace, b: GeoapifyPlace) => {
    const aScore = priority.findIndex(cat => a.properties.categories?.includes(cat))
    const bScore = priority.findIndex(cat => b.properties.categories?.includes(cat))
    return (aScore === -1 ? 1 : aScore) - (bScore === -1 ? 1 : bScore)
  })

  return filtered.slice(0, 20)
}

/* ---------------- 3. MAIN PAGE COMPONENT ---------------- */

export default function GuestPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const eventId = resolvedParams.id

  const [step, setStep] = useState(1)
  const [isHost, setIsHost] = useState(false)
  const [eventName, setEventName] = useState('Loading...')
  const [userName, setUserName] = useState('')
  const [budget, setBudget] = useState(1000)
  const [dislikes, setDislikes] = useState('')
  const [partyMembers, setPartyMembers] = useState<any[]>([])
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [selectedVenue, setSelectedVenue] = useState<GeoapifyPlace | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [userCoords, setUserCoords] = useState<{ lat: number, long: number } | null>(null)
  const [centerPoint, setCenterPoint] = useState<{ lat: number, long: number } | null>(null)
  const [rejectedSpots, setRejectedSpots] = useState<string[]>([])

  const hasJoined = useRef(false)

  /* --- REAL-TIME SYNC --- */
  useEffect(() => {
    const fetchMembers = async () => {
      const { data: members } = await supabase.from('responses').select('*').eq('event_id', eventId)
      if (!members) return
      setPartyMembers(members)
      const valid = members.filter(m => m.lat && m.long)
      if (valid.length > 0) {
        setCenterPoint({
          lat: valid.reduce((s, m) => s + m.lat, 0) / valid.length,
          long: valid.reduce((s, m) => s + m.long, 0) / valid.length
        })
      }
    }

    const initEvent = async () => {
      if (localStorage.getItem(`host_${eventId}`) === 'true') setIsHost(true)
      const { data: ev } = await supabase.from('events').select('*').eq('id', eventId).single()
      if (ev) {
        setEventName(ev.event_name)
        if (ev.ai_verdict) {
          setAiResult(ev.ai_verdict)
          setStep(4)
        }
      }
      fetchMembers()
    }
    initEvent()

    const channel = supabase.channel(`room-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responses', filter: `event_id=eq.${eventId}` }, () => fetchMembers())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, (payload) => {
        if (payload.new.ai_verdict) {
          setAiResult(payload.new.ai_verdict)
          setStep(4)
        }
      }).subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [eventId])

  const getLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserCoords({ lat: pos.coords.latitude, long: pos.coords.longitude }),
      () => alert("Please enable GPS permissions")
    )
  }

  const submitResponse = async () => {
    if (!userName || !userCoords) return alert("Name and location required")
    if (hasJoined.current) return setStep(3)
    const { error } = await supabase.from('responses').insert([{ event_id: eventId, user_name: userName, budget_max: budget, dislikes: dislikes || "None", lat: userCoords.lat, long: userCoords.long }])
    if (!error) { hasJoined.current = true; setStep(3); }
  }

  /* --- AI DECISION LOGIC --- */
  const closeTheDeal = async (isReroll = false) => {
    if (!centerPoint || partyMembers.length < 1) return alert("Waiting for squad data...")
    setIsCalculating(true)

    try {
      const places = await fetchMeetupPlaces(centerPoint.lat, centerPoint.long)
      const filteredPlaces = places.filter((p: GeoapifyPlace) => !rejectedSpots.includes(p.properties.name))
      const nearbyOptions = filteredPlaces.map((p: GeoapifyPlace) => `${p.properties.name} (Type: ${p.properties.categories?.[0]})`).join("\n")
      const minBudget = Math.min(...partyMembers.map(m => m.budget_max))
      const squadInfo = partyMembers.map(m => `- ${m.user_name}: Max ₹${m.budget_max} (Hates: ${m.dislikes})`).join("\n")

      const prompt = `You are "The Closer", a witty food critic. Pick ONE spot from this list: \n${nearbyOptions}\nSquad Info: \n${squadInfo}\nRules: Under ₹${minBudget}. Roast in 2 lines. Put the chosen name in [Brackets]. End with **Final Verdict**.`

      const chat = await groq.chat.completions.create({ messages: [{ role: "user", content: prompt }], model: "llama-3.3-70b-versatile" })
      const verdict = chat.choices[0]?.message?.content || "AI error."
      
      const match = verdict.match(/\[(.*?)\]/)
      if (match) {
        setRejectedSpots(prev => [...prev, match[1]])
        const venue = filteredPlaces.find(p => p.properties.name === match[1]) || null
        setSelectedVenue(venue)
      }

      const { error } = await supabase.from('events').update({ ai_verdict: verdict }).eq('id', eventId)
      if (!error) { setAiResult(verdict); setStep(4); }
    } catch (err) { alert("AI logic failed") } finally { setIsCalculating(false) }
  }

  const openMaps = () => {
    if (!centerPoint) return
    let query = ""
    if (selectedVenue) {
      // Precise Coordinate Mapping
      query = `${selectedVenue.properties.lat},${selectedVenue.properties.lon}`
    } else if (aiResult) {
      const match = aiResult.match(/\[(.*?)\]/)
      query = encodeURIComponent(`${match ? match[1] : "Restaurant"} near ${centerPoint.lat},${centerPoint.long}`)
    }
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, "_blank")
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-6 font-sans">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl">
        
        {step === 1 && (
          <div className="space-y-6">
            <h1 className="text-3xl font-black text-center uppercase tracking-tight text-blue-500">{eventName}</h1>
            <input className="w-full p-4 bg-slate-800 rounded-2xl border border-slate-700 outline-none" placeholder="Your Name" onChange={(e) => setUserName(e.target.value)} />
            <button onClick={() => userName ? setStep(2) : alert("Name?")} className="w-full bg-blue-600 py-4 rounded-2xl font-black transition transform active:scale-95">CONTINUE →</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <button onClick={getLocation} className={`w-full py-4 rounded-2xl border ${userCoords ? 'bg-emerald-900/20 border-emerald-500 text-emerald-400' : 'border-slate-700 text-slate-300'}`}>{userCoords ? "📍 Location Locked" : "📍 Share GPS Location"}</button>
            <div className="space-y-3">
              <div className="flex justify-between text-xs font-bold uppercase text-slate-500"><span>Max Budget</span><span className="text-blue-400">₹{budget}</span></div>
              <input type="range" className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" min="200" max="5000" step="100" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
            </div>
            <input className="w-full p-4 bg-slate-800 rounded-2xl border border-slate-700 outline-none" placeholder="Any food dislikes?" onChange={(e) => setDislikes(e.target.value)} />
            <button onClick={submitResponse} className="w-full bg-emerald-600 py-4 rounded-2xl font-black transition transform active:scale-95">JOIN THE SQUAD</button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-8 text-center">
            <h2 className="text-2xl font-black">{eventName}</h2>
            <div className="flex flex-wrap gap-2 justify-center">
              {partyMembers.map((m, i) => <div key={i} className="bg-slate-800 border border-slate-700 px-4 py-2 rounded-full text-xs font-bold animate-pulse">{m.user_name}</div>)}
            </div>
            {isHost ? <button onClick={() => closeTheDeal(false)} disabled={isCalculating} className="w-full bg-blue-600 py-5 rounded-3xl font-black shadow-lg shadow-blue-900/20 disabled:opacity-50">{isCalculating ? "🤖 THINKING..." : "DECIDE OUR FATE"}</button> : <p className="text-slate-500 italic">Waiting for host...</p>}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-3xl font-black text-emerald-400 text-center">The Verdict</h2>

            {selectedVenue && (
              <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-3xl shadow-xl border border-blue-400/30">
                <span className="text-[10px] font-black bg-white/20 px-2 py-1 rounded text-white uppercase tracking-widest">Top Pick</span>
                <h3 className="text-2xl font-black mt-2 leading-tight">{selectedVenue.properties.name}</h3>
                <p className="text-blue-100 text-xs mt-1 opacity-80 capitalize">
                  {selectedVenue.properties.categories?.[0]?.split('.')?.pop()?.replace('_', ' ')} • {Math.round(selectedVenue.properties.distance)}m away
                </p>
              </div>
            )}

            <div className="bg-black/30 p-6 rounded-3xl border border-slate-800 text-slate-200 text-sm leading-relaxed italic whitespace-pre-wrap">
              {aiResult?.replace(/\[.*?\]/, "")} 
            </div>
            
            <button onClick={openMaps} className="w-full bg-white text-black py-4 rounded-2xl font-black flex items-center justify-center gap-2">🚀 TAKE US THERE</button>
            {isHost && <button onClick={() => closeTheDeal(true)} className="w-full text-slate-600 text-[10px] uppercase font-bold tracking-widest hover:text-slate-400 transition">Reroll</button>}
          </div>
        )}
      </div>
    </div>
  )
}