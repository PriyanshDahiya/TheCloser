'use client'
import { useState, use, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Groq from "groq-sdk"

const groq = new Groq({ 
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
  dangerouslyAllowBrowser: true 
})

export default function GuestPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const resolvedParams = use(params)
  const eventId = resolvedParams.id

  // UI State
  const [step, setStep] = useState(1) 
  const [isHost, setIsHost] = useState(false)
  const [eventName, setEventName] = useState('Loading...')
  const [userName, setUserName] = useState('')
  const [budget, setBudget] = useState(1000) 
  const [dislikes, setDislikes] = useState('')
  const [partyMembers, setPartyMembers] = useState<any[]>([])
  
  // Logic State
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [userCoords, setUserCoords] = useState<{lat: number, long: number} | null>(null)
  const [centerPoint, setCenterPoint] = useState<{lat: number, long: number} | null>(null)
  const [rejectedSpots, setRejectedSpots] = useState<string[]>([])

  // Use a ref to track if we've already joined to avoid re-joins on re-renders
  const hasJoined = useRef(false)

  useEffect(() => {
    const initEvent = async () => {
      // 1. Check Host Status
      const hostStatus = localStorage.getItem(`host_${eventId}`)
      if (hostStatus === 'true') setIsHost(true)

      // 2. Fetch Event & Existing Verdict
      const { data: ev } = await supabase.from('events').select('event_name, ai_verdict').eq('id', eventId).single()
      if (ev) {
        setEventName(ev.event_name)
        if (ev.ai_verdict) {
          setAiResult(ev.ai_verdict)
          setStep(4)
        }
      }

      // 3. Fetch Initial Members
      fetchMembers()
    }

    const fetchMembers = async () => {
      const { data: members } = await supabase.from('responses').select('user_name, budget_max, dislikes, lat, long').eq('event_id', eventId)
      if (members && members.length > 0) {
        setPartyMembers(members)
        const valid = members.filter(m => m.lat && m.long)
        if (valid.length > 0) {
          setCenterPoint({
            lat: valid.reduce((sum, m) => sum + m.lat, 0) / valid.length,
            long: valid.reduce((sum, m) => sum + m.long, 0) / valid.length
          })
        }
      }
    }

    initEvent()

    // Real-time Subscriptions
    const channel = supabase.channel(`room-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responses', filter: `event_id=eq.${eventId}` }, () => {
        fetchMembers()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, (payload) => {
        if (payload.new.ai_verdict) {
          setAiResult(payload.new.ai_verdict)
          setStep(4)
        } else {
          setAiResult(null)
          setStep(3)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [eventId]) // Removed 'step' to prevent "flashing" loops

  const getLocation = () => {
    if (!navigator.geolocation) return alert("GPS not supported")
    navigator.geolocation.getCurrentPosition((pos) => {
      setUserCoords({ lat: pos.coords.latitude, long: pos.coords.longitude })
    }, () => alert("Please enable location permissions!"))
  }

  const submitResponse = async () => {
    if (!userName || !userCoords) return alert("Name and Location required!")
    if (hasJoined.current) return setStep(3)

    const { error } = await supabase.from('responses').insert([{ 
        event_id: eventId, user_name: userName, budget_max: budget, 
        dislikes: dislikes || "None", lat: userCoords.lat, long: userCoords.long 
    }])
    
    if (!error) {
      hasJoined.current = true
      setStep(3)
    }
  }

  const closeTheDeal = async (isReroll = false) => {
    if (partyMembers.length === 0 || !centerPoint) return alert("Waiting for data...")
    setIsCalculating(true)

    // Handle Reroll tracking
    if (isReroll && aiResult) {
      const match = aiResult.match(/\[(.*?)\]/);
      if (match) setRejectedSpots(prev => [...prev, match[1]]);
    }

    try {
      // 1. Call Geoapify
      const geoResp = await fetch(
        `https://api.geoapify.com/v2/places?categories=catering.restaurant,catering.fast_food,catering.cafe&filter=circle:${centerPoint.long},${centerPoint.lat},4000&bias=proximity:${centerPoint.long},${centerPoint.lat}&limit=20&apiKey=${process.env.NEXT_PUBLIC_GEOAPIFY_KEY}`
      );
      const geoData = await geoResp.json();
      const nearbyOptions = geoData.features
        ?.map((f: any) => `${f.properties.name} (${f.properties.street || ''})`)
        .filter((n: string) => !n.includes('undefined'))
        .join(", ") || "No local data found";

      const minBudget = Math.min(...partyMembers.map(m => m.budget_max));
      const squadInfo = partyMembers.map(m => `- ${m.user_name}: ₹${m.budget_max} (Dislikes: ${m.dislikes})`).join("\n");

      // 2. Groq AI logic
      const prompt = `You are "The Closer," a witty scout in India. 
      SQUAD INFO:
      ${squadInfo}
      
      MAP DATA: ${nearbyOptions}
      REJECTED: ${rejectedSpots.join(", ")}, Subway.

      TASK:
      1. Pick ONE venue from the MAP DATA (or use your knowledge of Sonipat/Delhi if data is empty).
      2. Budget is strictly ₹${minBudget} max per person.
      3. Format venue in brackets: [Venue Name].
      4. Roast the squad (or the solo diner) in 2 snappy lines. 
      5. End with **Final Verdict**.`;

      const chat = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.7,
      });

      const verdict = chat.choices[0]?.message?.content || "AI went on a break."

      // 3. Update Supabase (triggers other users' screens to flip)
      const { error } = await supabase.from('events').update({ ai_verdict: verdict }).eq('id', eventId)
      if (!error) {
        setAiResult(verdict)
        setStep(4)
      }

    } catch (err) { alert("API Error. Check console.") } 
    finally { setIsCalculating(false) }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-[2rem] shadow-2xl transition-all">
        
        {/* STEP 1: WELCOME */}
        {step === 1 && (
          <div className="space-y-6">
            <h1 className="text-3xl font-black text-center uppercase tracking-tighter">{eventName}</h1>
            <input className="w-full p-4 bg-slate-800 border border-slate-700 rounded-xl outline-none" placeholder="Your Name" onChange={(e) => setUserName(e.target.value)} />
            <button onClick={() => userName ? setStep(2) : alert("Name?")} className="w-full bg-blue-600 py-4 rounded-xl font-black">CONTINUE →</button>
          </div>
        )}

        {/* STEP 2: PREFERENCES */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-blue-400">The Vibe Check</h2>
            <button onClick={getLocation} className={`w-full py-4 rounded-xl font-bold border-2 transition-all ${userCoords ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-slate-700 text-slate-500'}`}>
              {userCoords ? "📍 Location Locked" : "📍 Share GPS"}
            </button>
            <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-500">Max Budget: ₹{budget}</label>
                <input type="range" min="200" max="5000" step="100" className="w-full accent-blue-500" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
            </div>
            <input className="w-full p-4 bg-slate-800 border border-slate-700 rounded-xl outline-none" placeholder="Dislikes? (No Veg, Spicy, etc.)" onChange={(e) => setDislikes(e.target.value)} />
            <button onClick={submitResponse} className="w-full bg-emerald-600 py-4 rounded-xl font-black">ENTER LOBBY</button>
          </div>
        )}

        {/* STEP 3: LOBBY */}
        {step === 3 && (
          <div className="text-center space-y-6">
            <div className="text-5xl animate-bounce">🍕</div>
            <h2 className="text-2xl font-black uppercase italic">The Squad</h2>
            <div className="flex flex-wrap gap-2 justify-center">
              {partyMembers.map((m, i) => (
                <span key={i} className="bg-slate-800 border border-slate-700 px-3 py-1 rounded-lg text-xs font-bold">{m.user_name}</span>
              ))}
            </div>
            {isHost ? (
              <button onClick={() => closeTheDeal(false)} disabled={isCalculating} className="w-full bg-blue-600 py-4 rounded-xl font-black shadow-lg shadow-blue-500/20">
                {isCalculating ? "🤖 CALCULATING..." : "GENERATE VERDICT"}
              </button>
            ) : (
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest animate-pulse">Waiting for host to close the deal...</p>
            )}
          </div>
        )}

        {/* STEP 4: VERDICT */}
        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-3xl font-black text-emerald-400 text-center uppercase tracking-tighter">The Decision</h2>
            <div className="bg-black/40 border border-white/5 p-6 rounded-2xl text-slate-200 italic leading-relaxed">
                {aiResult?.split(/(\[.*?\])/g).map((part, i) => (
                  part.startsWith('[') && part.endsWith(']') ? 
                  <span key={i} className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-bold not-italic">{part.replace(/[\[\]]/g, '')}</span> : part
                ))}
            </div>
            <button onClick={() => {
                  const match = aiResult?.match(/\[(.*?)\]/);
                  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((match ? match[1] : "Food") + " near " + centerPoint?.lat + "," + centerPoint?.long)}`, '_blank');
              }} className="w-full bg-blue-600 py-4 rounded-xl font-black">🚀 OPEN IN GOOGLE MAPS</button>
            {isHost && (
              <button onClick={() => closeTheDeal(true)} disabled={isCalculating} className="w-full text-slate-600 text-[10px] font-black uppercase hover:text-slate-400 transition-colors">
                Trash choice? Reroll
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}