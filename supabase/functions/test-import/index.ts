// supabase/functions/test-import/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import AssemblyAI from "npm:assemblyai" // This is what we're testing

serve(async (req) => {
  return new Response(
    JSON.stringify({ message: "Import successful", hasAssemblyAI: !!AssemblyAI }),
    {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    }
  )
})
