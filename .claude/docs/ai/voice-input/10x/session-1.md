# 10x Analysis: Voice Input for Account / Invoice Fields

Session 1 | Date: 2026-09-17

## Current Value

Desktop Electron accounting app. Core loop: pick/create party → bill → print.

Recent Urdu work added optional print fields (`nameUrdu`, `addressUrdu`, `goodsNameUrdu` on accounts; `descriptionUrdu` on inventory; company profile Urdu). Empty Urdu already falls back to English on print (`invoiceUtils`, print locale tests). Bulk spreadsheet import/export for account Urdu already ships (`ImportExportAccountUrdu`).

Pain users feel: account create form now shows **paired EN + UR fields inline** (`accountForm.tsx`). Counter staff typing Nastaliq is slow; Urdu keyboard / IME friction is real; billing waits on account setup.

## The Question

What is the simple, non-brittle, clean way to support voice so EN + UR fields stop blocking billing — without silent corruption of proper names?

---

## Hard constraints (do not ignore)

### 1. Web Speech API is a dead end in Electron

Reference hook ([anserwaseem/bujit `useSpeechRecognition.ts`](https://github.com/anserwaseem/bujit/blob/main/src/hooks/useSpeechRecognition.ts)) uses `webkitSpeechRecognition` / `SpeechRecognition` with `lang = "en-US"`.

That API depends on Chrome/Edge proprietary Google speech backends. In Electron it reliably fails with `"network"` (open issues through 2025–2026; on-device stubs return unavailable). **Porting the bujit hook as-is will look supported in Chrome and break in this app.** Keep the hook shape (start/stop/toggle, intentional-abort flag, callback refs) — swap the engine.

### 2. EN → UR “auto-translate” is the wrong problem for these fields

Account **name**, **address**, **goods/carrier name** are mostly:

- proper nouns (person / shop / firm)
- place names
- brand-like English fragments mixed into Urdu shop names (“Khan Cloth House”, “New Al-Balagh”)

Machine **translation** will invent meaning (`Cloth` → کپڑا) and destroy the print identity users expect. What people actually want for many fields is **transliteration** (roman → Nastaliq) or **native Urdu dictation** — not bilingual MT.

Translation is acceptable later for *sentence* fields (inventory description prose, print notes). Not for account identity fields in v1.

### 3. Urdu is already optional

Print already falls back when Urdu is empty. The form UX does not communicate that clearly — three extra RTL inputs sit in the main path and *feel* mandatory. Speech cannot fix a forced-feeling form; form hierarchy can.

---

## Massive Opportunities

### 1. Voice-first “new party” capture at the counter

**What**: One dictate surface: mic → short utterance(s) → draft account (name, phones, address, goods) → confirm → save → continue invoice.
**Why 10x**: Removes keyboard entirely from the pre-invoice friction point.
**Unlocks**: Fast walk-in customers; less training; works for low-literacy operators if STT is solid.
**Effort**: High (STT pipeline + slot parse + UX + error recovery).
**Risk**: Parsing free speech is brittle; wrong phone/address is costly; needs review step always.
**Score**: 🤔 — transformative if STT quality holds; too much surface for first ship.

### 2. Online STT platform as a first-class input modality

**What**: Main-process speech service (Whisper API / Google Chirp ur-PK / similar), mic permission, offline-degraded messaging.
**Why 10x**: Makes every text field speakable across accounts, inventory, journals — compounding.
**Unlocks**: Same mic control reused everywhere; adaptation lexicon of existing account names over time.
**Effort**: High (keys, privacy, packaging mic permissions, cost).
**Risk**: Network dependency; API cost; Urdu WER still non-trivial (~18–47% in public Whisper benchmarks depending on domain).
**Score**: 👍 as platform bet; 🔥 only after a thin field-mic slice proves daily use.

---

## Medium Opportunities

### 1. Per-field mic, language owned by the field (recommended core)

**What**: Small mic affordance on text inputs. Focused field decides STT language:

| Field | STT lang |
| --- | --- |
| `accountName`, `address`, `goodsName`, phones | `en` (or `en-PK` if available) |
| `nameUrdu`, `addressUrdu`, `goodsNameUrdu` | `ur` / `ur-PK` |

Transcript **inserts/replaces into that field only**. User always sees and can edit before save. No auto-fill of the pair field.

**Why 10x**: Matches how people already think (“speak Urdu into Urdu box”). Zero silent cross-language corruption. Same pattern works on inventory `descriptionUrdu` later.

**Impact**: Cuts Nastaliq typing time without inventing a brittle translation layer.

**Effort**: Medium — shared `SpeechInputButton` + main-process STT IPC + Settings API key; reuse bujit UX patterns (listening state, intentional stop, haptics optional).

**Score**: 🔥

### 2. Collapse “Print (Urdu)” off the critical path

**What**: Account form: English + phones stay primary. Urdu trio moves into a collapsed “Print name / address / goods (Urdu) — optional, falls back to English” section. Hint: fill later or via Import Urdu.

**Why 10x**: Many complaints are *time-to-invoice*, not “I must dictate Urdu every time.” Shipping speech while leaving six fields always open is treating symptom only.

**Impact**: Immediate UX win with no STT risk; pairs with existing bulk Urdu import.

**Effort**: Low.

**Score**: 🔥 — do even if speech slips.

### 3. Opt-in “Fill Urdu from English” = transliterate, never translate

**What**: After English name/address/goods filled, button: “Suggest Urdu script”. Uses transliteration (roman → Arabic/Nastaliq), not MT. Preview in a confirm row; never overwrite silently.

**Why 10x**: Helps operators who speak names in English letters but need Urdu print — common for shop names already typed in Roman.

**Impact**: Useful assist; wrong for mixed English words unless user edits.

**Effort**: Medium (library or small LLM prompt constrained to “transliterate only, preserve English tokens”).

**Score**: 👍 as phase 2, not phase 1.

### 4. EN speech → auto UR counterpart via MT

**What**: Speak English once; MT fills `*Urdu` fields.
**Why it sounds good**: One utterance, both columns.
**Why it fails**: Proper-noun destruction; silent wrong print; hard to trust; support burden when bills show nonsense Urdu.
**Score**: ❌ for account identity fields. Maybe later for long description prose only, always with preview.

---

## Small Gems

### 1. Default create-account → resume invoice deep link

**What**: From New Invoice “add party”, return to same invoice draft after save.
**Why powerful**: Voice or not, removes context switch.
**Effort**: Low–medium.
**Score**: 👍

### 2. Mic only on Urdu fields first

**What**: Ship mic on the three Urdu inputs only — highest keyboard pain, smallest blast radius.
**Why powerful**: Proves STT + Electron + ur-PK before decorating every input.
**Effort**: Low once STT IPC exists.
**Score**: 🔥 for MVP scope.

### 3. Existing bulk Import Urdu as the batch answer

**What**: Stop selling voice as the backfill tool. Spreadsheet already exists.
**Why powerful**: Voice = live counter; sheet = 200 accounts.
**Effort**: None (docs / tooltip clarity).
**Score**: 🔥 (positioning, not code).

### 4. Offline / unsupported honest empty state

**What**: If no API key or mic denied: hide mic or show one clear Settings CTA — never a dead button.
**Why powerful**: Trust > fake Chrome speech that errors `network`.
**Effort**: Low.
**Score**: 🔥

---

## Recommended Priority

### Do Now

1. **Collapse optional Urdu section on account (and custom-head) forms** — Why: stops optional work from blocking billing; print fallback already correct. Impact: time-to-invoice drops without STT.

2. **Do not port bujit Web Speech into Electron** — Why: known broken. Keep hook UX ideas only.

3. **MVP: mic on Urdu fields only → cloud STT `ur-PK` → insert into field** — Why: solves the actual keyboard pain; language = field; user edits. Prefer OpenAI Whisper API *or* Google STT Chirp `ur-PK` behind one `speech:transcribe` IPC. Settings stores key (same pattern as other cloud creds / deferred Supabase→client-config work).

### Do Next

1. **Mic on English twin fields** (`en`) with the same control.
2. **Opt-in “Suggest Urdu script” transliteration** with explicit accept — never MT auto-fill.
3. **Reuse `SpeechInputButton` on inventory description Urdu / company profile**.

### Explore

1. **Dictate whole account** modal — only after per-field STT accuracy is trusted in real shop noise.
2. **Local whisper.cpp** for offline shops — packaging weight + Electron ABI pain; not first.
3. **Lexicon adaptation** from existing `accounts.name` / `nameUrdu` to bias STT — compounds over time.

### Backlog

1. EN→UR MT for prose descriptions.
2. Continuous multi-field dictation grammar.
3. On-device OS speech frameworks (macOS/Windows) — platform split, higher maintenance.

---

## Proposed UX (aesthetically simple)

```
Account Name          [________________] 
Phone / Address / …   (primary path)

▸ Print in Urdu (optional — empty uses English above)
    Account Name (Urdu)  [________اردو__]  🎤
    Address (Urdu)       [________اردو__]  🎤
    Goods Name (Urdu)    [________اردو__]  🎤
    [ Suggest from English… ]   // phase 2, preview dialog
```

Mic states: idle → pulse while listening → transcript lands → soft toast only on hard failure.

No floating badges on unrelated chrome. One control. Field-local. Matches existing shadcn density.

---

## Architecture sketch (non-brittle)

```
Renderer: SpeechInputButton (lang, onTranscript)
   → ipc speech:transcribe({ audioBase64, lang })
Main: Speech.service
   → provider (Whisper | Google), timeout, size limits
   → returns { text } | { error }
Settings: speechProvider + apiKey (never in renderer logs)
```

Reuse from bujit: callback refs, intentional-stop flag, `isSupported` gate. Replace: recognition engine entirely.

**Success criteria (verifiable):**

1. With no API key, mic not shown or opens Settings — no `network` ghost errors.
2. Speaking into `nameUrdu` never mutates `accountName`.
3. Empty Urdu still prints English (existing tests stay green).
4. Manual edit after transcript always possible; save stores exactly what’s in the input.
5. Shop-noise smoke test on 10 real account names (mix Roman shop names + pure Urdu) before expanding beyond Urdu fields.

---

## Evaluation table

| Approach | Impact | Brittleness | Fit for names/address | Electron reality | Verdict |
| --- | --- | --- | --- | --- | --- |
| Collapse optional Urdu | High (speed) | None | N/A | Fine | Do now |
| Field mic, lang=field | High | Low | Excellent | Needs cloud STT | Do now (MVP) |
| EN speak → MT → Urdu | Med illusion | High | Poor | Needs STT+MT | Pass |
| EN speak → transliterate → Urdu | Med | Med | OK with review | Needs STT or text | Phase 2 |
| Port bujit Web Speech | — | — | — | Broken | Pass |
| Full dictate form | High if perfect | High | Risky | Needs STT+NLP | Later |

---

## Questions

### Answered

- **Q**: Support both EN and UR speech? **A**: Yes — but per field, not one mode that translates.
- **Q**: English-only + auto Urdu? **A**: No for identity fields. Transliteration assist later, never silent MT.
- **Q**: Reuse bujit hook? **A**: UX/state machine yes; Web Speech engine no.
- **Q**: Is speech the only fix? **A**: No — form hierarchy + existing bulk import already remove most “hassle”; speech is the live-counter accelerator.

### Blockers (need product input)

- **Q**: Which STT provider budget/privacy is acceptable (OpenAI vs Google vs local)? Offline shops?
- **Q**: Confirm real complaint = Nastaliq typing vs “too many fields” vs both. (Recommendation assumes both; collapse + mic covers both.)
- **Q**: Are goods names usually Urdu words, English carrier brands, or mixed? (Affects whether ur-only MVP is enough.)

## Next Steps

- [ ] Decide STT provider + key storage approach
- [ ] Ship Urdu-section collapse on account form (no speech dependency)
- [ ] Spike `speech:transcribe` with 10 real shop-name utterances in ur-PK
- [ ] Only then add `SpeechInputButton` on Urdu fields
- [ ] Explicitly reject EN→UR MT auto-fill in design review

---

## Citation / evidence

- Account form Urdu fields: `src/renderer/views/Accounts/accountForm.tsx`
- Print fallback when Urdu empty: `src/renderer/lib/invoiceUtils.ts`, print locale tests
- Bulk Urdu import already exists: `ImportExportAccountUrdu.tsx`, `accountUrduImport.ts`
- Electron Web Speech failure: electron#46143, electron#31732 (network error / proprietary Chrome service)
- Urdu ASR difficulty: public Whisper Urdu WER still material on conversational/telephonic audio — expect edit-after-dictate, not hands-free perfection
