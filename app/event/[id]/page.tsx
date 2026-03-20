'use client'

import { useState, use, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Groq from "groq-sdk"

const groq = new Groq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
  dangerouslyAllowBrowser: true
})

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

/* ---------------- FETCH PLACES ---------------- */

async function fetchMeetupPlaces(lat: number, long: number): Promise<GeoapifyPlace[]> {
  const categories = "catering.cafe,catering.restaurant,catering.pub,catering.bar"
  const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${long},${lat},5000&limit=50&sort=distance&apiKey=${process.env.NEXT_PUBLIC_GEOAPIFY_KEY}`

  const res = await fetch(url)
  const data = await res.json()
  return (data.features || []).slice(0, 20)
}

/* ---------------- MAIN COMPONENT ---------------- */

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

  // 🔥 NEW: reroll memory
  const [rejectedSpots, setRejectedSpots] = useState<string[]>([])

  const hasJoined = useRef(false)

  /* ---------------- REALTIME ---------------- */

  useEffect(() => {
    const fetchMembers = async () => {
      const { data } = await supabase.from('responses').select('*').eq('event_id', eventId)
      if (!data) return

      setPartyMembers(data)

      const valid = data.filter(m => m.lat && m.long)
      if (valid.length > 0) {
        setCenterPoint({
          lat: valid.reduce((s, m) => s + m.lat, 0) / valid.length,
          long: valid.reduce((s, m) => s + m.long, 0) / valid.length
        })
      }
    }

    const init = async () => {
      if (localStorage.getItem(`host_${eventId}`) === 'true') setIsHost(true)

      const { data } = await supabase.from('events').select('*').eq('id', eventId).single()

      if (data) {
        setEventName(data.event_name)

        if (data.ai_verdict) {
          setAiResult(data.ai_verdict)
          setStep(4)

          if (data.winner_details) {
            setSelectedVenue(data.winner_details)
          }
        }
      }

      fetchMembers()
    }

    init()

    const channel = supabase.channel(`room-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responses', filter: `event_id=eq.${eventId}` }, fetchMembers)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, (payload) => {
        if (payload.new.ai_verdict) {
          setAiResult(payload.new.ai_verdict)
          setStep(4)
          setSelectedVenue(payload.new.winner_details)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [eventId])

  /* ---------------- ACTIONS ---------------- */

  const getLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserCoords({ lat: pos.coords.latitude, long: pos.coords.longitude }),
      () => alert("Enable GPS")
    )
  }

  const submitResponse = async () => {
    if (!userName || !userCoords) return alert("Fill all fields")

    const { error } = await supabase.from('responses').insert([{
      event_id: eventId,
      user_name: userName,
      budget_max: budget,
      dislikes: dislikes || "None",
      lat: userCoords.lat,
      long: userCoords.long
    }])

    if (error) alert(error.message)
    else setStep(3)
  }

  /* ---------------- AI / RANDOM PICK ---------------- */

  const closeTheDeal = async (isReroll = false) => {
    if (!centerPoint) return alert("Waiting for members")

    setIsCalculating(true)

    try {
      const places = await fetchMeetupPlaces(centerPoint.lat, centerPoint.long)

      // 🔥 filter out already used places
      const available = places.filter(
        p => !rejectedSpots.includes(p.properties.name)
      )

      if (available.length === 0) {
        alert("No more places to suggest 😭")
        setIsCalculating(false)
        return
      }

      const pick = available[Math.floor(Math.random() * available.length)]

      // 🔥 store for reroll prevention
      setRejectedSpots(prev => [...prev, pick.properties.name])

      const verdict = `Alright squad... we’re going to [${pick.properties.name}] 🍽️\nNo complaints. Just vibes.`

      const { error } = await supabase.from('events').update({
        ai_verdict: verdict,
        winner_name: pick.properties.name,
        winner_details: pick,
        centroid_lat: centerPoint.lat,
        centroid_long: centerPoint.long
      }).eq('id', eventId)

      if (error) {
        console.error(error)
        alert(error.message)
      } else {
        setAiResult(verdict)
        setSelectedVenue(pick)
        setStep(4)
      }

    } catch (err) {
      console.error(err)
      alert("Something went wrong")
    } finally {
      setIsCalculating(false)
    }
  }

  const openMaps = () => {
    if (!selectedVenue) return
    window.open(`https://www.google.com/maps/search/?api=1&query=${selectedVenue.properties.lat},${selectedVenue.properties.lon}`)
  }

  /* ---------------- UI ---------------- */

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-white p-6">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-[2.5rem] shadow-2xl">

        {/* STEP 1 */}
        {step === 1 && (
          <div className="space-y-8">
            <h1 className="text-3xl font-black text-center bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              {eventName}
            </h1>

            <input
              className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-blue-400 transition"
              placeholder="Enter your name"
              onChange={(e) => setUserName(e.target.value)}
            />

            <button
              onClick={() => userName ? setStep(2) : alert("Enter name")}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 py-4 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition"
            >
              Continue →
            </button>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="space-y-8">

            <button
              onClick={getLocation}
              className={`w-full py-4 rounded-2xl font-semibold transition ${
                userCoords
                  ? 'bg-emerald-500/20 border border-emerald-400 text-emerald-300'
                  : 'bg-white/5 border border-white/10 text-white'
              }`}
            >
              {userCoords ? "📍 Location Locked" : "📍 Share Location"}
            </button>

            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-slate-400">Budget</span>
                <span className="text-2xl font-black text-blue-400">₹{budget}</span>
              </div>

              <input
                type="range"
                min="200"
                max="5000"
                step="100"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-full h-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg"
              />
            </div>

            <input
              className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl outline-none"
              placeholder="Food dislikes?"
              onChange={(e) => setDislikes(e.target.value)}
            />

            <button
              onClick={submitResponse}
              className="w-full bg-gradient-to-r from-emerald-500 to-green-600 py-4 rounded-2xl font-bold"
            >
              Join Squad 🚀
            </button>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div className="space-y-8 text-center">
            <h2 className="text-2xl font-black">{eventName}</h2>

            <div className="flex flex-wrap gap-2 justify-center">
              {partyMembers.map((m, i) => (
                <div key={i} className="bg-white/10 px-4 py-2 rounded-full text-sm">
                  {m.user_name}
                </div>
              ))}
            </div>

            {isHost ? (
              <button
                onClick={() => closeTheDeal(false)}
                disabled={isCalculating}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 py-5 rounded-2xl font-bold"
              >
                {isCalculating ? "🤖 Thinking..." : "Decide the Spot"}
              </button>
            ) : (
              <p className="text-slate-400">Waiting for host...</p>
            )}
          </div>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <div className="space-y-6">

            <h2 className="text-3xl font-black text-center text-emerald-400">
              Final Verdict 🍽️
            </h2>

            {selectedVenue && (
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-6 rounded-3xl">
                <h3 className="text-xl font-black">{selectedVenue.properties.name}</h3>
                <p className="text-sm opacity-80">
                  {Math.round(selectedVenue.properties.distance)}m away
                </p>
              </div>
            )}

            <div className="bg-white/5 p-5 rounded-2xl text-sm whitespace-pre-wrap italic">
              {aiResult}
            </div>

            <button
              onClick={openMaps}
              className="w-full bg-white text-black py-4 rounded-2xl font-bold"
            >
              🚀 Open in Maps
            </button>

            {/* 🔥 REROLL BUTTON */}
            {isHost && (
              <button
                onClick={() => closeTheDeal(true)}
                disabled={isCalculating}
                className="w-full mt-2 text-sm text-slate-400 hover:text-white"
              >
                🔄 Reroll another spot
              </button>
            )}

          </div>
        )}

      </div>
    </div>
  )
}