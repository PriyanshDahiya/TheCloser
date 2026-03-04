'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createdEvent, setCreatedEvent] = useState<{id: string, name: string} | null>(null)

  const createEvent = async () => {
    if (!eventName.trim()) return alert("Please enter an event name!")
    
    setIsCreating(true)
    const { data, error } = await supabase
      .from('events')
      .insert([{ event_name: eventName }])
      .select()
      .single()

    setIsCreating(false)

    if (error) {
      alert("Error creating event: " + error.message)
    } else {
      // --- NEW: Mark this browser as the HOST for this specific event ID ---
      localStorage.setItem(`host_${data.id}`, 'true')
      
      setCreatedEvent({ id: data.id, name: data.event_name })
    }
  }

  // Generate the full URL for sharing
  const getShareLink = () => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/event/${createdEvent?.id}`
    }
    return ''
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl">
        
        {!createdEvent ? (
          /* --- STEP 1: NAME THE EVENT --- */
          <div className="animate-in fade-in zoom-in duration-300">
            <h1 className="text-4xl font-black mb-2 text-center bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              THE CLOSER
            </h1>
            <p className="text-slate-400 text-center mb-8 text-sm uppercase tracking-widest">Setup your hangout</p>
            
            <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-tighter">Event Name</label>
            <input 
              className="w-full p-4 bg-slate-800 border border-slate-700 rounded-xl mb-6 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-white"
              placeholder="e.g. Saturday Night Biryani"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />

            <button 
              onClick={createEvent}
              disabled={isCreating}
              className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-black text-white transition-all active:scale-95 shadow-lg shadow-blue-900/20 disabled:opacity-50"
            >
              {isCreating ? "CREATING..." : "🚀 START NEW EVENT"}
            </button>
          </div>
        ) : (
          /* --- STEP 2: SHARE THE LINK --- */
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">🔥</div>
              <h2 className="text-2xl font-bold uppercase">{createdEvent.name}</h2>
              <p className="text-emerald-400 text-sm font-medium">Event is live!</p>
            </div>

            <div className="space-y-4">
              <div className="bg-black/40 p-4 rounded-2xl border border-slate-800">
                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">Share this link with your squad</label>
                <div className="flex items-center gap-2">
                  <input 
                    readOnly 
                    className="bg-transparent text-xs text-blue-400 outline-none flex-1 truncate"
                    value={getShareLink()}
                  />
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(getShareLink())
                      alert("Link copied!")
                    }}
                    className="text-xs bg-slate-700 px-3 py-1 rounded-md hover:bg-slate-600 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <button 
                onClick={() => router.push(`/event/${createdEvent.id}`)}
                className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-2xl font-black text-white transition-all shadow-lg shadow-emerald-900/20"
              >
                GO TO DASHBOARD →
              </button>

              {/* --- NEW: Cancel/Go Back Feature --- */}
              <button 
                onClick={() => {
                  localStorage.removeItem(`host_${createdEvent.id}`)
                  setCreatedEvent(null)
                }}
                className="w-full text-slate-500 text-xs uppercase tracking-widest py-2 hover:text-red-400 transition-colors"
              >
                Cancel and Start Over
              </button>
            </div>
          </div>
        )}

      </div>
      
      <p className="mt-8 text-slate-600 text-xs uppercase tracking-[0.3em]">Built for the Squad</p>
    </div>
  )
}