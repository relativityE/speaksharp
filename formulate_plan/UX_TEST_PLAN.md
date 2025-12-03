# SpeakSharp UX/UI Test Plan - Complete User Journey

## Test Execution Strategy

### Prerequisites
- Clean browser state (incognito/private mode)
- Valid test credentials for Free, Pro, and Dev tiers
- Microphone permissions granted
- Stable internet connection

### Recording Requirements
- Record full browser session for each journey
- Capture console logs for errors
- Note performance metrics (load times, STT latency)
- Screenshot key states (empty states, error states, success states)

---

## Journey 1: First-Time User - Sign Up Flow

### 1.1 Landing Page Experience
- [ ] Navigate to homepage
- [ ] Verify hero section displays correctly
- [ ] Verify features section is visible
- [ ] Click "Get Started" button
- [ ] Verify redirect to `/auth/signup`

### 1.2 Sign Up Process
- [ ] Enter email address
- [ ] Enter password (test validation: too short, no special chars, etc.)
- [ ] Submit form
- [ ] Verify loading state during submission
- [ ] **Expected**: Account created, auto-signed in (or email confirmation message)
- [ ] Verify redirect to `/` (home/dashboard)

### 1.3 Post-Sign-Up Navigation
- [ ] Verify Navigation component shows authenticated state
- [ ] Verify "Home", "Session", "Analytics" links visible
- [ ] Verify "Sign Out" button present
- [ ] Verify "Sign In" and "Get Started" buttons hidden

---

## Journey 2: Returning User - Sign In Flow

### 2.1 Sign In Process
- [ ] Navigate to `/auth/signin`
- [ ] Enter valid credentials
- [ ] Submit form
- [ ] Verify loading state
- [ ] **Expected**: Successful sign-in, redirect to `/`
- [ ] Verify authenticated navigation state

### 2.2 Sign In Error Handling
- [ ] Attempt sign-in with invalid password
- [ ] **Expected**: Error message displayed
- [ ] Verify error clears on new submission
- [ ] Attempt sign-in with non-existent email
- [ ] **Expected**: Appropriate error message

---

## Journey 3: Session Recording - Local Device Mode

### 3.1 Navigate to Session Page
- [ ] Click "Session" in navigation
- [ ] Verify redirect to `/session`
- [ ] Verify page title: "Practice Session"
- [ ] Verify "Live Recording" card present

### 3.2 Initial State Verification
- [ ] Verify status indicator shows "READY" or "LOADING"
- [ ] Verify start/stop button is enabled (or disabled if not ready)
- [ ] Verify metrics cards display: Clarity Score, Speaking Rate, Filler Words
- [ ] Verify Pause Metrics Display component present
- [ ] Verify elapsed time shows "00:00"

### 3.3 Start Recording - Local Device
- [ ] Ensure STT mode is set to "Local Device" (check settings if available)
- [ ] Click start button
- [ ] **Expected**: Microphone permission prompt (if first time)
- [ ] Grant microphone permission
- [ ] Verify button changes to "Stop" state
- [ ] Verify status indicator shows "RECORDING" or similar
- [ ] Verify timer starts incrementing

### 3.4 Live Transcription - Local Device
- [ ] Speak clearly: "Hello, this is a test of the local device transcription."
- [ ] **Expected**: Transcript appears in real-time
- [ ] Verify transcript confidence indicator (if shown)
- [ ] Speak with filler words: "Um, so, like, you know, I think this is working."
- [ ] **Expected**: Filler words detected and counted
- [ ] Verify Filler Words metric updates
- [ ] Pause for 2-3 seconds
- [ ] **Expected**: Pause metrics update (total pauses, average duration)

### 3.5 Metrics During Recording
- [ ] Verify Clarity Score updates (or shows placeholder)
- [ ] Verify Speaking Rate (WPM) calculates correctly
- [ ] Verify Filler Words count increments
- [ ] Verify Pause Metrics Display shows data

### 3.6 Stop Recording
- [ ] Click stop button
- [ ] Verify recording stops
- [ ] Verify timer stops
- [ ] Verify final metrics displayed
- [ ] Verify transcript persists

---

## Journey 4: Session Recording - Native Mode

### 4.1 Switch to Native Mode
- [ ] Click settings button (if available on Session page)
- [ ] Select "Native" STT mode
- [ ] Verify mode change confirmation

### 4.2 Start Recording - Native
- [ ] Click start button
- [ ] Verify microphone access
- [ ] Verify status shows recording

### 4.3 Live Transcription - Native
- [ ] Speak: "Testing native speech recognition mode."
- [ ] **Expected**: Transcript appears (may have different latency than local)
- [ ] Note transcription accuracy differences
- [ ] Speak with filler words: "Uh, basically, um, this should work."
- [ ] Verify filler detection

### 4.4 Performance Comparison
- [ ] Note latency differences vs. Local Device
- [ ] Note accuracy differences
- [ ] Verify metrics still update correctly

### 4.5 Stop and Review
- [ ] Stop recording
- [ ] Verify session data saved
- [ ] Verify metrics finalized

---

## Journey 5: Session Recording - Cloud Mode

### 5.1 Switch to Cloud Mode
- [ ] Open settings
- [ ] Select "Cloud" STT mode (AssemblyAI or similar)
- [ ] Verify mode change

### 5.2 Start Recording - Cloud
- [ ] Click start button
- [ ] Verify recording starts
- [ ] Note any initialization delay

### 5.3 Live Transcription - Cloud
- [ ] Speak: "This is a test of cloud-based speech recognition."
- [ ] **Expected**: Transcript appears (may have network latency)
- [ ] Speak technical terms: "JavaScript, TypeScript, React, Supabase."
- [ ] Verify accuracy of technical vocabulary
- [ ] Speak with filler words
- [ ] Verify detection

### 5.4 Network Resilience
- [ ] (Optional) Briefly disconnect network mid-recording
- [ ] **Expected**: Error handling or buffering
- [ ] Reconnect
- [ ] Verify recovery

### 5.5 Stop and Review
- [ ] Stop recording
- [ ] Verify session saved
- [ ] Verify cloud processing completes

---

## Journey 6: Custom Vocabulary Management

### 6.1 Access Custom Vocabulary
- [ ] On Session page, locate "Custom Vocabulary Manager" component
- [ ] Verify component renders
- [ ] Verify empty state (if no custom words)

### 6.2 Add Custom Words
- [ ] Add custom word: "SpeakSharp"
- [ ] Add custom word: "Supabase"
- [ ] Add custom word: "Vitest"
- [ ] Verify words appear in list
- [ ] Verify save/update functionality

### 6.3 Test Custom Words in Recording
- [ ] Start new recording (any STT mode)
- [ ] Speak custom words: "I'm using SpeakSharp with Supabase and testing with Vitest."
- [ ] **Expected**: Custom words transcribed correctly (if supported by STT mode)
- [ ] Verify improved accuracy

### 6.4 Remove Custom Words
- [ ] Remove one custom word
- [ ] Verify removal
- [ ] Verify list updates

---

## Journey 7: Analytics Page - Dashboard View

### 7.1 Navigate to Analytics
- [ ] Click "Analytics" in navigation
- [ ] Verify redirect to `/analytics`
- [ ] Verify page title: "Analytics Dashboard"

### 7.2 Empty State (New User)
- [ ] If no sessions exist, verify empty state displays
- [ ] Verify empty state message
- [ ] Verify analytics visualization image (if present)
- [ ] Verify call-to-action to create first session

### 7.3 Dashboard with Data
- [ ] After completing sessions, return to analytics
- [ ] Verify session history list displays
- [ ] Verify each session shows: date, duration, key metrics
- [ ] Verify sessions are sorted (most recent first)

### 7.4 Metrics Overview
- [ ] Verify overall statistics (if shown): total sessions, average clarity, etc.
- [ ] Verify charts/graphs display correctly
- [ ] Verify data accuracy matches session data

---

## Journey 8: Analytics Page - Session Detail View

### 8.1 Navigate to Session Detail
- [ ] Click on a specific session in history
- [ ] Verify redirect to `/analytics/{sessionId}`
- [ ] Verify page title changes to "Session Analysis"

### 8.2 Session Detail Content
- [ ] Verify session metadata: date, duration
- [ ] Verify detailed metrics: Clarity Score, Speaking Rate, Filler Words, Pause Metrics
- [ ] Verify transcript display (if available)
- [ ] Verify filler word breakdown (which words, how many)
- [ ] Verify pause analysis (distribution, patterns)

### 8.3 Session Not Found
- [ ] Navigate to `/analytics/invalid-session-id`
- [ ] **Expected**: "Session Not Found" message
- [ ] Verify link back to dashboard
- [ ] Click link, verify return to `/analytics`

---

## Journey 9: Upgrade Banner (Free Tier)

### 9.1 Free User on Analytics
- [ ] Sign in as Free tier user
- [ ] Navigate to `/analytics`
- [ ] Verify upgrade banner displays: "Unlock Your Full Potential"
- [ ] Verify upgrade button present
- [ ] Click upgrade button
- [ ] **Expected**: Redirect to pricing/upgrade page (or modal)

### 9.2 Pro User on Analytics
- [ ] Sign in as Pro tier user
- [ ] Navigate to `/analytics`
- [ ] Verify NO upgrade banner displays

### 9.3 Upgrade Banner on Session View
- [ ] As Free user, navigate to `/analytics/{sessionId}`
- [ ] Verify NO upgrade banner on session detail view

---

## Journey 10: Sign Out and Re-Sign In

### 10.1 Sign Out
- [ ] Click "Sign Out" button in navigation
- [ ] Verify sign-out confirmation (if any)
- [ ] **Expected**: Redirect to `/` (unauthenticated home)
- [ ] Verify navigation shows "Sign In" and "Get Started" buttons
- [ ] Verify "Home", "Session", "Analytics" links hidden

### 10.2 Attempt Protected Route Access
- [ ] Manually navigate to `/session`
- [ ] **Expected**: Redirect to `/auth/signin` or show auth required message
- [ ] Manually navigate to `/analytics`
- [ ] **Expected**: Redirect to `/auth/signin` or show auth required message

### 10.3 Re-Sign In
- [ ] Click "Sign In" button
- [ ] Enter credentials
- [ ] Submit
- [ ] **Expected**: Successful sign-in, redirect to `/`
- [ ] Verify authenticated state restored
- [ ] Navigate to `/session`, verify access granted
- [ ] Navigate to `/analytics`, verify previous session data visible

---

## Journey 11: Edge Cases and Error Handling

### 11.1 Network Errors
- [ ] Disconnect network
- [ ] Attempt to sign in
- [ ] **Expected**: Network error message
- [ ] Reconnect
- [ ] Retry sign-in
- [ ] **Expected**: Success

### 11.2 Session Errors
- [ ] Start recording without microphone permission
- [ ] **Expected**: Permission error message
- [ ] Grant permission
- [ ] Retry
- [ ] **Expected**: Recording starts

### 11.3 Long Session
- [ ] Start recording
- [ ] Let run for 5+ minutes
- [ ] Speak intermittently
- [ ] Verify metrics continue updating
- [ ] Verify no memory leaks (check browser dev tools)
- [ ] Stop recording
- [ ] Verify session saves correctly

### 11.4 Rapid Start/Stop
- [ ] Start recording
- [ ] Immediately stop
- [ ] Start again
- [ ] Stop again
- [ ] Repeat 3-5 times
- [ ] **Expected**: No crashes, clean state transitions

### 11.5 Browser Refresh During Recording
- [ ] Start recording
- [ ] Refresh browser
- [ ] **Expected**: Recording stops, data may be lost (or saved, depending on implementation)
- [ ] Verify app recovers to clean state

---

## Journey 12: Multi-Tab Behavior

### 12.1 Multiple Tabs
- [ ] Open app in Tab 1
- [ ] Sign in
- [ ] Open app in Tab 2 (same browser)
- [ ] Verify both tabs show authenticated state
- [ ] Sign out in Tab 1
- [ ] **Expected**: Tab 2 also reflects signed-out state (or requires refresh)

### 12.2 Concurrent Sessions
- [ ] In Tab 1, start recording
- [ ] In Tab 2, navigate to Session page
- [ ] **Expected**: Either prevent concurrent recording or show warning
- [ ] Stop recording in Tab 1
- [ ] Verify Tab 2 can now start recording

---

## Journey 13: Accessibility Testing

### 13.1 Keyboard Navigation
- [ ] Navigate entire app using only Tab key
- [ ] Verify all interactive elements reachable
- [ ] Verify focus indicators visible
- [ ] Use Enter/Space to activate buttons
- [ ] Verify all functionality accessible via keyboard

### 13.2 Screen Reader
- [ ] Enable screen reader (VoiceOver, NVDA, JAWS)
- [ ] Navigate through app
- [ ] Verify all content announced correctly
- [ ] Verify form labels associated with inputs
- [ ] Verify button purposes clear

### 13.3 Color Contrast
- [ ] Verify text meets WCAG AA contrast ratios
- [ ] Test in high contrast mode
- [ ] Verify UI remains usable

---

## Journey 14: Mobile Responsiveness

### 14.1 Mobile Navigation
- [ ] Open app on mobile device (or responsive mode)
- [ ] Verify mobile navigation renders
- [ ] Verify hamburger menu (if applicable)
- [ ] Verify all pages accessible

### 14.2 Mobile Session Recording
- [ ] Navigate to Session page on mobile
- [ ] Start recording
- [ ] Verify UI adapts to mobile screen
- [ ] Verify metrics readable
- [ ] Verify controls accessible

### 14.3 Mobile Analytics
- [ ] Navigate to Analytics on mobile
- [ ] Verify charts/graphs responsive
- [ ] Verify session list readable
- [ ] Verify session detail view usable

---

## Test Execution Checklist

### Before Testing
- [ ] Review all test cases
- [ ] Prepare test accounts (Free, Pro, Dev)
- [ ] Set up screen recording
- [ ] Clear browser cache/cookies
- [ ] Verify microphone working

### During Testing
- [ ] Record full session
- [ ] Take screenshots of key states
- [ ] Note any bugs/issues
- [ ] Document performance observations
- [ ] Log console errors

### After Testing
- [ ] Review recordings
- [ ] Compile bug list
- [ ] Document UX improvements
- [ ] Create issue tickets
- [ ] Update test plan based on findings

---

## Success Criteria

✅ **All journeys complete without critical errors**
✅ **All 3 STT modes functional**
✅ **Authentication flows work correctly**
✅ **Session data persists and displays in Analytics**
✅ **Custom vocabulary improves transcription**
✅ **Metrics calculate accurately**
✅ **Error handling graceful**
✅ **Mobile experience usable**
✅ **Accessibility standards met**
✅ **Performance acceptable (< 3s page loads, < 500ms STT latency)**
