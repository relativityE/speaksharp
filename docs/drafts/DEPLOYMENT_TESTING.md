# Phase 2 Deployment & Testing Instructions

## Overview
This guide covers deploying and testing the Phase 2 Critical Must-Haves: Console Log Cleanup, Custom Vocabulary, and Pause Detection.

---

## Prerequisites

- [ ] Code merged to `main` branch
- [ ] Deployed to staging/production environment
- [ ] Pro user account for testing
- [ ] Supabase production access

---

## Step 1: Apply Database Migration

### Via Supabase Dashboard (Recommended)

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Navigate to your project → **SQL Editor**
3. Copy SQL from `supabase/migrations/20251120004400_custom_vocabulary.sql`
4. Paste and click **Run**
5. Verify success:
   ```sql
   SELECT * FROM custom_vocabulary LIMIT 1;
   SELECT * FROM pg_policies WHERE tablename = 'custom_vocabulary';
   ```

### Via Supabase CLI (Alternative)

```bash
# Link to production project
supabase link --project-ref <your-project-ref>

# Push migration
supabase db push

# Verify
supabase db diff
```

---

## Step 2: Test Custom Vocabulary Feature

### Setup
1. **Log in as Pro user** (or upgrade test account to Pro)
2. Navigate to **Session Page** (`/sessions`)

### Test Flow

#### A. Add Custom Words
1. Locate **Custom Vocabulary** card in sidebar
2. Add test words:
   - `SpeakSharp`
   - `AssemblyAI`
   - `OpenAI`
   - `React-Query`
3. Verify:
   - [ ] Words appear in list after adding
   - [ ] Validation works (try empty, >50 chars, invalid chars)
   - [ ] Duplicate prevention works
   - [ ] Word count shows (e.g., "3/100")

#### B. Remove Words
1. Click X button on a word
2. Verify:
   - [ ] Word removed from list
   - [ ] Count updates

#### C. Test AssemblyAI Boost (Cloud Mode)
1. Start a session with **Cloud AI mode** selected
2. Speak clearly using custom vocabulary words:
   - "I'm using SpeakSharp with AssemblyAI for transcription"
3. Check browser DevTools → Network → WebSocket
4. Find AssemblyAI WebSocket connection
5. Verify URL includes: `&boost_param=speaksharp,assemblyai`
6. Observe transcript accuracy for custom words

---

## Step 3: Test Pause Detection

### Setup
1. Navigate to **Session Page** (`/sessions`)
2. Start a recording session

### Test Flow

#### A. Visual Verification
1. Locate **Pause Analysis** card in sidebar
2. Verify card shows:
   - Total Pauses: `0`
   - Per Minute: `0.0`
   - Average: `0ms` or `0.0s`
   - Longest: `0ms` or `0.0s`

#### B. Create Pauses
1. **Start recording**
2. Speak: "Hello world"
3. **Pause for 1 second** (silent)
4. Speak: "This is a test"
5. **Pause for 2 seconds**
6. Speak: "Testing pauses"
7. **Stop recording**

#### C. Verify Metrics
Check Pause Analysis card:
- [ ] Total Pauses: Should show `2` (or more if you paused >500ms)
- [ ] Per Minute: Should show reasonable rate
- [ ] Average: Should be ~1-2 seconds
- [ ] Longest: Should be ~2 seconds

---

## Step 4: Verify Live Transcript Latency

### Requirements
- Pro account with Cloud AI mode enabled
- Real microphone input
- Stable internet connection

### Test Procedure

1. **Start Session** (Cloud AI mode)
2. **Open browser console** (F12 → Console)
3. **Start recording** and speak continuously:
   - "Testing one two three four five six seven eight nine ten"
4. **Measure latency:**
   - Note when you finish saying a word
   - Observe when it appears in transcript
   - Goal: **< 2 seconds from speech to display**

5. **Test with multiple browsers:**
   - [ ] Chrome/Edge (primary)
   - [ ] Safari (if macOS)
   - [ ] Firefox

6. **Test scenarios:**
   - [ ] Clear speech, quiet room
   - [ ] Background noise
   - [ ] Fast speaking
   - [ ] Long sentences

### Expected Results
- ✅ **P95 latency < 2 seconds** for clear speech
- ✅ Partial transcript updates in real-time
- ✅ Final transcript appears after pause/turn

---

## Step 5: Smoke Test All Features

### Quick Validation Checklist

**Session Page:**
- [ ] Start/Stop recording works
- [ ] Live transcript appears
- [ ] Filler word detection works
- [ ] Custom Vocabulary card visible (Pro only)
- [ ] Pause Analysis card visible
- [ ] Speaking Tips card visible

**Custom Vocabulary:**
- [ ] Can add words
- [ ] Can remove words
- [ ] Non-Pro users see upgrade prompt
- [ ] Words persist across sessions

**Pause Detection:**
- [ ] Metrics update during recording
- [ ] Metrics display after recording
- [ ] Reset on new session

**Analytics Page:**
- [ ] Session history shows new sessions
- [ ] Charts render correctly
- [ ] Goals section displays

---

## Troubleshooting

### Custom Vocabulary

**Issue:** Words not appearing after add
- Check browser console for errors
- Verify database migration applied: `SELECT * FROM custom_vocabulary;`
- Check RLS policies: User must be authenticated

**Issue:** AssemblyAI not using custom words
- Verify WebSocket URL includes `boost_param`
- Check AssemblyAI API token is valid
- Ensure Cloud AI mode is selected

### Pause Detection

**Issue:** No pauses detected
- Pauses must be >500ms to count
- Verify mic permissions granted
- Check browser console for errors

**Issue:** Incorrect pause times
- Expected behavior - pause detection is approximate
- Mic sensitivity affects detection
- Background noise can interfere

### Latency Issues

**Issue:** Transcript delayed >2s
- Check internet connection speed
- Verify AssemblyAI API status
- Test in different network environment
- Check browser performance (CPU usage)

---

## Rollback Procedure

If critical issues found:

### 1. Disable Features (Quick Fix)

```typescript
// In SessionPage.tsx, comment out:
// <CustomVocabularyManager />
// <PauseMetricsDisplay ... />
```

### 2. Revert Migration (If Needed)

```sql
-- Run in Supabase SQL Editor
DROP TABLE IF EXISTS custom_vocabulary CASCADE;
```

### 3. Revert Code

```bash
git revert <commit-hash>
git push origin main
```

---

## Success Criteria

Before marking deployment complete:

- [ ] Supabase migration applied successfully
- [ ] Custom Vocabulary CRUD works
- [ ] Custom words visible in AssemblyAI WebSocket URL
- [ ] Pause Detection displays metrics
- [ ] Live transcript latency < 2s (P95)
- [ ] No console errors in production
- [ ] All smoke tests pass
- [ ] Pro users can access all features
- [ ] Free users see appropriate upgrade prompts

---

## Post-Deployment Monitoring

**First 24 hours:**
- Monitor Sentry for errors
- Check Supabase logs for database issues
- Monitor AssemblyAI API usage/costs
- Collect user feedback via support channels

**Metrics to track:**
- Custom vocabulary adoption rate (Pro users)
- Average words per vocabulary
- Pause detection accuracy (user feedback)
- Transcript latency (PostHog or manual testing)

---

## Support

**Issues:**
- Check `docs/TROUBLESHOOTING.md` (if exists)
- Review Sentry error logs
- Check Supabase database logs

**Questions:**
- Refer to `temp-instructions/SUPABASE_MIGRATIONS.md`
- Review implementation plan in artifacts
- Contact development team
