---
name: ensoul
description: Turn a user-authorized corpus into a dated, evidence-calibrated, explicitly partial and revisable whole-person working model. Use when Codex is asked to understand, capture, or reconstruct a person; create a personal operating manual, master document, digital-twin or proxy bootstrap; extract worldview, values, taste, communication style, decisions, tensions, or tacit patterns; enrich a person with public research; or combine structured Ensoul source packets from Peopleblade or Message Like Me with notes, messages, posts, documents, repositories, and other evidence.
---

# Ensoul

Turn only the evidence the user authorizes into a dated, standalone working model of a person. Recover explicit facts and tacit patterns without flattening the subject into a resume, work persona, archetype, personality score, or supposedly complete identity record.

The result should help a thoughtful collaborator understand the subject and let an assistant reason, write, prioritize, and collaborate in a way that resembles their demonstrated patterns. It must also say where resemblance would be unsafe or unsupported.

## Core standard

Aim for fidelity and ambition, not false completeness.

Treat the output as a purpose-shaped interpretation of a bounded corpus, not a definitive account of a person. Confidence describes support for a claim within the evidence examined; it does not say how essentially that claim defines the subject or how reliably it predicts them everywhere. Keep every part revisable in light of new evidence, changed circumstances, and the subject's corrections. The ambition is whole-person; the claim is never completeness.

- Infer from repeated choices, behavior, language, tradeoffs, and evolution across time.
- Preserve contradictions and live tensions instead of forcing one coherent story.
- Separate the subject's voice from quotations, correspondents, meeting participants, collaborators, institutions, and AI-generated material.
- Weight costly behavior and repeated decisions above polished self-description.
- Date the model. People and priorities change.
- Make confidence, scope, uncertainty, and plausible alternative readings legible.
- Avoid diagnosis and unsupported sensitive-attribute inference.
- Never use the result to impersonate the subject deceptively or take consequential external actions in their name.

## Default output

Produce one new Markdown document unless the user requests another format. Use a descriptive filename such as `<person>-ensoul.md` and return its full path.

Scale the document to the evidence. For a rich longitudinal corpus with several independent source strata, roughly 4,000-8,000 useful words can be appropriate. Length is an outcome, not a target. With fewer than three independent source strata or fewer than 2,000 source words, use only the space supported claims require—often 300-1,500 words and sometimes less. Do not add a section to approach a lower bound or manufacture breadth.

The document must stand alone. Define local jargon, projects, relationships, dates, and source limitations so a reader does not need the original corpus.

Open with a prominent epistemic-status block stating that the document is partial, source-bounded, dated, and revisable. Do not bury this in methodology or endnotes.

## Workflow

### 1. Establish authority and scope

Use the user's supplied corpus, public sources they request, and local sources they explicitly place in scope. Make reasonable assumptions about output location and format.

Classify the intended use before synthesis:

- **Self-model:** the subject is the user.
- **Private collaboration guide:** the user has legitimate access to evidence about another person and wants privacy-minimized help communicating or collaborating with them.
- **Authorized proxy:** the subject has explicitly authorized voice resemblance or proxy preparation for the stated use.

Possession of messages, a packet, or public information is not subject authorization. A private collaboration guide may describe bounded, observable interaction patterns for the user's own preparation, but must not imitate the subject's voice, evaluate fitness or character, predict sensitive behavior, or support employment, credit, housing, insurance, legal, medical, disciplinary, or other consequential decisions. Do not produce a reusable proxy or assistant charter for a third-party subject without explicit subject authorization. Ask when the intended use is ambiguous, evaluative, externally facing, or consequential.

Ask only when a missing choice would materially change the result, such as when:

- the corpus is unavailable;
- the subject is ambiguous;
- the user has not authorized access to a proposed private source;
- the output is meant for a public audience and privacy boundaries are unclear.

Do not browse for personal information by default. Browse when the user asks, when a supplied URL must be opened, or when a time-sensitive public fact needs verification. Keep public web evidence distinct from private and supplied evidence.

Use format-specific skills when needed to read PDFs, documents, sheets, slides, images, audio, or video. Extract faithfully before interpreting.

For a caller-owned official X archive, use `bun scripts/prepare-x-archive.ts` rather than manually extracting it. The script opens only allowlisted account-authored public-post members and writes a bounded private packet. It deliberately does not open direct messages, address books, ad data, media, deleted posts, or community posts. Confirm archive ownership with the user, use absolute paths, and keep the packet outside version control.

### 2. Inventory the corpus

Read [references/evidence-method.md](references/evidence-method.md) completely before analyzing sources.

If the corpus contains `ensoul.*-source` packets, also read [references/source-packets.md](references/source-packets.md) completely before opening or interpreting them.

Validate each packet before opening or interpreting its records:

```sh
bun scripts/validate-source-packet.ts /absolute/private/path/source.ensoul-source.json
```

Require a zero exit status and a receipt with `valid: true`. The dependency-free validator emits only schema/digest/count metadata. If validation fails, do not inspect, guess, repair, or partially use the packet.

Build a source map before drafting. Record:

- source type, locator, and date range;
- likely author or speaker;
- whether it is private capture, polished self-presentation, observed behavior, third-party description, or institutional material;
- signal strengths, biases, sampling method, and omissions;
- temporal relevance and identity-binding strength.

For repositories, inspect more than prose. Use contributor identity, authored plans, commit history, code ownership, tests, incidents, and operational artifacts. Do not attribute a repository-wide norm to the subject without authorship or repeated adoption evidence.

For notes, distinguish the subject's thoughts from what another person said. For messages and email, distinguish drafts, sent messages, quoted or forwarded text, and the correspondent's voice.

### 3. Sample broadly, then pursue signal

Cover the corpus across time, context, and artifact type before going deep on one theme.

For a large corpus:

1. Index filenames, dates, authors, headings, source kinds, and recurring terms.
2. Read representative material from early, middle, and recent periods.
3. Identify recurring decisions, metaphors, values, conflicts, and changes.
4. Read the highest-signal artifacts in full.
5. Continue until additional sources mostly reinforce known patterns or reveal a meaningful contradiction.

Do not claim exhaustive reading when sampling. State coverage honestly.

Optional subagents may summarize bounded source strata for very large corpora. Give each only its assigned artifacts and require paths, dates, attribution, candidate patterns, counterevidence, and confidence. Never delegate private packets or private content unless the user explicitly authorizes that exact additional environment and data scope; Message Like Me packets remain with the main agent by default. The main agent must inspect high-weight sources itself and owns synthesis.

### 4. Build an evidence ledger

Keep a scratch ledger for candidate claims. Each claim should track:

- the proposed pattern;
- supporting sources across contexts;
- counterevidence or exceptions;
- plausible alternative explanations;
- whether evidence is factual, stated, behavioral, linguistic, relational, or temporal;
- evidentiary support and scope of generalization;
- current, historical, emerging, cyclical, or unresolved status.

Do not make the ledger the final deliverable unless requested.

Use these labels:

- **Well-supported observation:** explicit and repeated, or behaviorally demonstrated with little material counterevidence.
- **Supported inference:** recurring or cross-context evidence supports the claim, but an interpretive step remains.
- **Live question:** evidence shows tension, change, or unresolved context rather than a stable pattern.
- **Tentative hypothesis:** plausible but narrow or weakly supported; usually omit from the executive model.

The labels describe evidence for a bounded claim. They do not reveal an essential identity, prove motive, or guarantee future behavior. State scope separately. Omit unsupported claims.

A single event is normally a tentative hypothesis, even when vivid. Treat an observation as well-supported only when repeated independent evidence supports it, or when an explicit current subject correction has corroborating behavior.

### 5. Model the whole person

Investigate every dimension for which the corpus has real evidence:

- identity, biography, and trajectory;
- roles, commitments, and present constraints;
- worldview and models of how the world works;
- values and moral intuitions;
- taste, aesthetics, humor, and aversions;
- motivations, incentives, and sources of meaning;
- decision-making and epistemic habits;
- work, craft, learning, and creative practice;
- communication and writing style by audience;
- collaboration, leadership, conflict, and trust;
- relationships to technology, money, status, risk, time, place, institutions, and community;
- routines and operating patterns;
- recurring tensions, shadow patterns, and failure modes;
- evolution over time;
- topics the corpus cannot support.

Work may dominate the evidence. Do not mistake work for the whole person. Say when the model is work-heavy, and do not invent private-life conclusions to create balance.

### 6. Separate four layers

Keep these analytically distinct:

1. **Facts:** names, dates, roles, projects, places, and events.
2. **Stated beliefs:** what the subject says they value or believe.
3. **Revealed patterns:** what repeated decisions and costly actions suggest.
4. **Speculation:** plausible hypotheses that remain weak or unresolved.

When belief and behavior conflict, preserve both. Consider audience, timing, constraint, aspiration, and change before declaring inconsistency.

### 7. Draft the standalone document

Read [references/output-blueprint.md](references/output-blueprint.md) completely before drafting.

Choose sections based on evidence rather than filling a rigid template. A strong document usually includes:

- usage and calibration notes;
- a visible epistemic-status block and revision date or trigger;
- an executive model;
- identity and trajectory;
- current life and commitments;
- worldview, values, and recurring mental models;
- sensibilities and taste;
- decision, work, learning, and communication style;
- relationship patterns supported by the corpus;
- tensions, counterweights, and failure modes;
- a practical operating manual;
- an assistant charter only for a self-model or explicitly subject-authorized proxy; otherwise, third-person collaboration-use boundaries with no voice imitation;
- silent questions and what not to infer;
- model limits, alternative readings, and revision hooks;
- source basis and as-of date.

Keep sensitive or potentially harmful claims out unless explicit, relevant, necessary, and appropriate for the intended audience. Never infer protected or highly sensitive traits from proxies, aesthetics, affiliations, or omissions.

### 8. Verify the document

Before delivery, audit it:

- Can every important factual claim be traced to the corpus?
- Are quotations, authors, and speakers correctly attributed?
- Did one vivid artifact dominate the synthesis?
- Are current and historical views separated?
- Are institutional norms mislabeled as personal traits?
- Are contradictions preserved?
- Are private third parties protected?
- Does confidence describe evidentiary support and scope rather than certainty about identity?
- Is the same insight repeated without a distinct function?
- When an assistant charter is allowed, does it include non-impersonation, intended use, expiration/review, and authority limits? Otherwise, are collaboration-use boundaries explicit and free of voice imitation?
- Could a skim reader mistake the document for a canonical identity record?
- Does the real person's current answer clearly outrank proxy predictions?
- Could the intended authorized reader understand the document without opening the corpus while learning no unnecessary private or third-party information?

Inspect the final file and return the full path.

## Quality bar

A weak result is a biography plus generic strengths. A strong result explains what the subject repeatedly notices; what they optimize for and will pay for; how they decide under uncertainty; how their voice changes by audience; what attracts and repels them; which tensions should remain open; where a proxy predicts poorly; how the model changed; and which claims are tacit, tentative, or context-bound.

Prefer precise behavioral language over flattering abstractions. “Repeatedly stages risky migrations with shadow reads and rollback gates” is better than “cares about quality.”

## Prohibited shortcuts

- Do not produce MBTI, Enneagram, Big Five, or an archetype unless explicitly requested.
- Do not diagnose mental health, neurotype, attachment style, or pathology.
- Do not infer political, religious, sexual, medical, racial, or other sensitive identity from indirect evidence.
- Do not equate polished self-description with demonstrated behavior.
- Do not treat frequency alone as importance.
- Do not confuse the loudest domain in the corpus with the whole person.
- Do not turn every contradiction into a synthesis. Some contradictions are real.
- Do not imitate typos, private harshness, or confidential details in an external-facing proxy voice.
- Do not pad thin evidence with universal personality language.
- Do not tell the subject who they “really are,” settle their motives, or override present choices.
- In reusable outputs, omit third-party sensitive facts, direct identifiers, raw quotations, and confidential judgments by default. Replace names with functional roles and paraphrase only the interaction context needed to support a subject claim. A user's request alone does not authorize disclosure of a third party's sensitive information; include it only when that third party authorized the specific use and the task strictly requires it. Record any exception and intended audience explicitly. Never expose secrets or credentials.
