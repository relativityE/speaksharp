import { useState, useRef, useEffect } from "react";
import { supabase } from '../lib/supabaseClient';

export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState("");
  const [isListening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);

  // Helper: convert Float32 [-1,1] → Int16 PCM
  const float32ToInt16 = (buffer) => {
    const l = buffer.length;
    const buf = new ArrayBuffer(l * 2);
    const view = new DataView(buf);
    for (let i = 0; i < l; i++) {
      let s = Math.max(-1, Math.min(1, buffer[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  };

  const getAssemblyAIToken = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('assemblyai-token');
      if (error) throw new Error(`Supabase function error: ${error.message}`);
      if (!data?.token) throw new Error('No token received from server');
      return data.token;
    } catch (err) {
      console.error('❌ Error getting AssemblyAI token:', err);
      setError(err.message);
      throw err;
    }
  };

  const startListening = async () => {
    if (isListening || isLoading) return;

    try {
      setError(null);
      setIsLoading(true);

      const token = await getAssemblyAIToken();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      streamRef.current = stream;

      const socket = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?token=${token}&sample_rate=16000&format_turns=true`
      );
      wsRef.current = socket;

      socket.onopen = () => {
        console.log('✅ AssemblyAI WebSocket connected');
        setListening(true);
        setIsLoading(false);

        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        sourceRef.current = source;
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = float32ToInt16(input);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(pcm16);
          }
        };
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.message_type === 'FinalTranscript' && data.text) {
          setTranscript(prev => prev + ' ' + data.text);
        }
      };

      socket.onerror = (error) => {
        console.error('❌ AssemblyAI WebSocket error:', error);
        setError('WebSocket connection failed');
        stopListening();
      };

      socket.onclose = (event) => {
        console.log('🔌 AssemblyAI WebSocket closed:', event.code, event.reason);
        if (event.code !== 1000) {
          setError(`Connection closed unexpectedly: ${event.reason}`);
        }
        stopListening();
      };

    } catch (err) {
      console.error('❌ Error starting transcription:', err);
      setError(err.message);
      setIsLoading(false);
    }
  };

  const stopListening = () => {
    if (!isListening && !isLoading) return;

    setIsLoading(true); // Indicate cleanup is happening

    if (processorRef.current) processorRef.current.disconnect();
    if (sourceRef.current) sourceRef.current.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    processorRef.current = null;
    sourceRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    wsRef.current = null;

    setListening(false);
    setIsLoading(false);
  };

  useEffect(() => {
    return () => stopListening();
  }, []);

  return { isListening, isLoading, transcript, error, startListening, stopListening };
};
