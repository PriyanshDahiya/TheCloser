'use server'
import { createClient } from '@supabase/supabase-js'
import Groq from "groq-sdk";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function closeTheDeal(eventId: string) {
  // 1. Get all friends who joined
  const { data: responses } = await supabase
    .from('responses')
    .select('*')
    .eq('event_id', eventId);

  // 2. Ask the AI (Groq/Llama 3) to decide
  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: "You are a funny, decisive AI. Pick ONE restaurant vibe based on these inputs." },
      { role: "user", content: JSON.stringify(responses) }
    ],
    model: "llama3-8b-8192",
  });

  return completion.choices[0].message.content;
}