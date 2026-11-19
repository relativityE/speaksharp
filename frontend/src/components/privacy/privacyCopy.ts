/**
 * #1835 — the words of the Practice privacy prompt (S1/S2) and Account → Privacy & data (S6/S7), kept apart from the
 * components so the components export only components and the tests can assert the exact copy.
 */
export const PRIVACY_PROMPT_COPY = {
  newTitle: 'Two choices before you start',
  newIntro: 'Your audio is transcribed here and never uploaded. You decide what happens to the transcript.',
  newFooter: 'You can change either choice any time in Account → Privacy & data.',
  returningTitle: 'Choose how your transcripts are used',
  returningIntro: 'Until now, each saved session was stored in your account and sent for AI coaching automatically. Coaching is paused until you choose.',
  returningFooter: 'This applies to new sessions. Anything already saved stays as it is; manage it in Account → Privacy & data.',
  saveLegend: 'Save transcripts to your account?',
  saveHelp: 'Your measurements (pace, filler words, clarity) are saved either way.',
  aiLegend: 'Get AI coaching?',
  aiHelp: 'After each saved session, your transcript and speaking measurements are sent to an AI service, which writes your review. Audio is never sent.',
  aiNeedsSave: 'AI coaching needs a saved transcript. Choose Save transcripts to use it.',
  continueReason: 'Choose both options to continue.',
  saveFailed: 'We couldn’t confirm your choices. Review the current settings before trying again.',
  changed: 'Your privacy settings changed elsewhere. Review the current settings before trying again.',
} as const;

export const PRIVACY_SETTINGS_COPY = {
  lead: 'Audio is transcribed on this device and never uploaded.',
  saveOn: 'New sessions keep their transcript in your account.',
  saveOff: 'New transcripts stay on the session page and aren’t saved.',
  ai: 'After each saved session, your transcript and speaking measurements are sent to an AI service to write your review. Audio is never sent.',
  aiNeedsSave: 'Needs Save transcripts to be on.',
  note: 'Turning a setting off stops future use. It doesn’t delete anything already saved.',
  loading: 'Loading your privacy choices…',
  unavailable: 'Your privacy choices couldn’t be loaded, so saving and AI coaching stay off. Reload to try again.',
  unknown: 'You haven’t chosen yet, so saving and AI coaching are off.',
  failed: 'Your change couldn’t be saved. Your settings show what’s in effect now.',
  changed: 'Your privacy settings changed elsewhere. Review the current settings before trying again.',
  stopTitle: 'Stop saving transcripts?',
  stopBody: 'New sessions won’t keep their transcript. AI coaching will turn off too, because it needs a saved transcript. Transcripts you’ve already saved stay until you delete them.',
} as const;
