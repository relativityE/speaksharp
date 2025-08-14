import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { SpeechClient } from 'npm:@google-cloud/speech';

// Deno requires explicit CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Initialize the Google Cloud Speech-to-Text client
    // The client automatically uses the GOOGLE_APPLICATION_CREDENTIALS_JSON
    // environment variable for authentication in the Supabase environment.
    const speechClient = new SpeechClient();

    // 2. Get the audio data from the request body
    // The client will send the audio as a base64-encoded string.
    const { audioBytes } = await req.json();
    if (!audioBytes) {
      throw new Error('No audio data found in the request.');
    }

    // 3. Configure the recognition request
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: 'WEBM_OPUS', // Modern browsers often record in webm/opus
        sampleRateHertz: 48000, // Common sample rate for web audio
        languageCode: 'en-US',
        model: 'latest_long', // Use Google's latest model for higher accuracy
      },
    };

    // 4. Call the API and process the response
    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      ?.map(result => result.alternatives?.[0].transcript)
      .join('\n');

    if (!transcription) {
      return new Response(
        JSON.stringify({ error: 'Unable to transcribe audio.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Return the transcript
    return new Response(
      JSON.stringify({ transcription }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in cloud-transcribe function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
