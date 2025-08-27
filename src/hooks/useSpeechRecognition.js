import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export const useSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const assemblyAIRef = useRef(null);
  const tokenRef = useRef(null);

  // Get AssemblyAI token with JWT authentication
  const getAssemblyAIToken = async () => {
    try {
      setIsLoading(true);

      // Get the current session and JWT
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(`Session error: ${sessionError.message}`);
      }

      if (!session?.access_token) {
        throw new Error('No authenticated session found. Please log in.');
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assemblyai-token`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to get token`);
      }

      const data = await response.json();

      if (!data.token) {
        throw new Error('No token received from server');
      }

      return data.token;
    } catch (err) {
      console.error('Error getting AssemblyAI token:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const startListening = async () => {
    try {
      setError(null);
      setIsLoading(true);

      // Get fresh token
      const token = await getAssemblyAIToken();
      tokenRef.current = token;

      // Initialize AssemblyAI WebSocket connection
      const socket = new WebSocket(`wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=${token}`);

      assemblyAIRef.current = socket;

      socket.onopen = () => {
        console.log('AssemblyAI WebSocket connected');
        setIsListening(true);
        setIsLoading(false);

        // Start browser speech recognition or audio capture here
        // This depends on your specific implementation
        startAudioCapture();
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.message_type === 'FinalTranscript') {
          setTranscript(prev => prev + ' ' + data.text);
        } else if (data.message_type === 'PartialTranscript') {
          // Handle partial transcripts if needed
          console.log('Partial:', data.text);
        }
      };

      socket.onerror = (error) => {
        console.error('AssemblyAI WebSocket error:', error);
        setError('WebSocket connection failed');
        setIsListening(false);
        setIsLoading(false);
      };

      socket.onclose = (event) => {
        console.log('AssemblyAI WebSocket closed:', event.code, event.reason);
        setIsListening(false);
        setIsLoading(false);

        if (event.code !== 1000) {
          setError('Connection closed unexpectedly');
        }
      };

    } catch (err) {
      setError(err.message);
      setIsListening(false);
      setIsLoading(false);
    }
  };

  const stopListening = () => {
    if (assemblyAIRef.current) {
      assemblyAIRef.current.close();
      assemblyAIRef.current = null;
    }

    // Stop audio capture
    stopAudioCapture();

    setIsListening(false);
  };

  const startAudioCapture = async () => {
    // Implement your audio capture logic here
    // This could be using getUserMedia() and AudioContext
    // or whatever method you're using to capture audio
    console.log('Starting audio capture...');
  };

  const stopAudioCapture = () => {
    // Implement stopping audio capture
    console.log('Stopping audio capture...');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (assemblyAIRef.current) {
        assemblyAIRef.current.close();
      }
      stopAudioCapture();
    };
  }, []);

  // Handle auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Stop listening if user signs out
        if (isListening) {
          stopListening();
        }
        setError('User signed out');
      } else if (event === 'TOKEN_REFRESHED') {
        // Token was refreshed, could optionally refresh AssemblyAI token too
        console.log('Auth token refreshed');
      }
    });

    return () => subscription.unsubscribe();
  }, [isListening]);

  return {
    isListening,
    transcript,
    error,
    isLoading,
    startListening,
    stopListening,
    clearTranscript: () => setTranscript(''),
    clearError: () => setError(null)
  };
};
