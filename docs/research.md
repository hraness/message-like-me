# Research and prior art

Message Like Me is a local measurement and profiling layer for message
drafting. It is not a model, an autonomous messaging agent, or a claim that a
software system represents a person. This review explains the evidence behind
that boundary and the neighboring open-source work that informed it.

The cited papers are primary research publications or preprints. Project
descriptions link to their official repositories. A paper result is evidence
about the task and population it evaluated, not proof that the same result
holds for private conversations across the messaging sources a user imports.

## Personalization is contextual

[PersonaChat](https://aclanthology.org/P18-1205/) found that conditioning a
dialogue system on both its assigned profile and information about its
interlocutor improved next-utterance prediction. More recent work on
[linguistic accommodation](https://aclanthology.org/2025.sigdial-1.16/) found
that human answers aligned more with a partner's style than LLM answers did,
while the LLM answers aligned more closely in semantic content.

These results do not establish a universal method for imitating a person.
They support a narrower design inference: a useful messaging profile should
separate broadly repeated tendencies from contact-specific and
context-specific adjustments. Message Like Me therefore treats incoming
messages as response context and only the user's outgoing messages as evidence
of the user's prose.

[LaMP](https://aclanthology.org/2024.acl-long.399/) evaluated personalized
classification and generation from user histories and found retrieval-based
personalization useful across most of its tasks. Its experiments included
term, semantic, and time-aware retrieval. [PEARL](https://aclanthology.org/2024.customnlp4u-1.16/)
studied personalized writing assistance and trained a retriever to select
historical documents according to their downstream generation value. PEARL
also used retrieval quality to identify outputs likely to need revision.

The project inference is selective rather than exhaustive use of history. A
small response-context sample with explicit coverage limits exposes less text
than placing an entire transcript in an agent prompt. Recency,
relationship, and current conversational purpose can all change which past
examples apply.

## Personalization needs held-out evaluation

[ExPerT](https://aclanthology.org/2025.findings-acl.900/) evaluates
personalized long-form generation by comparing evidence-bearing aspects of
content and writing style separately. Its reported agreement with human
judgment improved over the comparison methods in that study. It does not
measure message timing, bubble boundaries, or reply-link behavior.

[Münker, Schwager, and Rettinger](https://arxiv.org/abs/2506.21974) tested
LLM-based imitation of social-network communication and argue that a
simulation must be validated for empirical realism in the setting where it
was fitted. This supports holding later conversations out of profile creation,
drafting from their inbound context without seeing the historical response,
and only then comparing the candidate with the reference. A match on surface
features alone does not establish semantic equivalence, authorship, or
identity.

## Digital-agent results are task-bounded

[Generative Agents](https://arxiv.org/abs/2304.03442) showed that stored
experiences, retrieval, reflection, and planning can produce believable agent
behavior in a simulated town. Believability in that environment is not the
same as fidelity to a real individual.

[Generative Agent Simulations of 1,000 People](https://arxiv.org/abs/2411.10109)
built agents from two-hour interviews with 1,052 participants and evaluated
them on surveys, personality measures, and experimental replications. The
reported survey result is relative to how consistently participants repeated
their own answers two weeks later. It is not evidence that the agents could
write private messages like those participants or act on their behalf.

The accompanying [official repository](https://github.com/StanfordHCI/genagents)
does not publish the interview-derived individual agent bank. It describes
aggregated access for fixed tasks and reviewed access for individual outputs
because of participant privacy. That is useful precedent: an open-source
method can remain public while real person-level evidence stays private.

Message Like Me consequently uses the terms *style profile*, *historical
tendency*, and *draft candidate*. It does not use a messaging profile to infer
beliefs, personality, relationship quality, future behavior, or authority to
represent the user.

## Private text can remain revealing

[Quantifying Memorization Across Neural Language Models](https://arxiv.org/abs/2202.07646)
found that extractable memorization increased with model capacity, repeated
examples, and longer prompting context in the evaluated model families.
[Beyond Memorization](https://arxiv.org/abs/2310.07298) showed that LLMs could
infer personal attributes from text even when the task was not extraction of a
memorized training example. Removing obvious names is therefore not a complete
privacy defense.

[When Personalization Misleads](https://aclanthology.org/2026.findings-acl.395/)
found that personalization could steer factual answers toward a user's prior
history rather than objective truth in its evaluated settings. The project
inference is that meaning, current intent, and factual correctness must outrank
style fidelity.

[NIST's digital identity risk guidance](https://pages.nist.gov/800-63-4/sp800-63/dirm/)
lists impersonation, privacy loss, and reputational damage among relevant
harms. Message Like Me reduces those risks through local storage, bounded
exports, pseudonymous ordinary views, explicit provenance, and the absence of
message-sending commands. Those controls do not create consent from a
conversation partner or make a hosted agent local.

## Tempo is relational and descriptive

A 2026 preprint on [response times in donated WhatsApp and Instagram chats](https://arxiv.org/abs/2605.03687)
reported persistent response-speed similarity between chat partners in its
sample. This is preliminary evidence from different platforms and cannot set a
norm for users of any supported messaging source. It does support comparing
tempo within a dyad instead of treating one global latency distribution as a
personal rule.

Historical latency is affected by sleep, work, travel, notifications, device
availability, urgency, and missing data. Message Like Me reports it as
descriptive metadata. It does not tell an agent to wait before returning a
draft or portray a historical delay as a preference or promise.

## Open-source landscape

| Project | Public scope | Relevant distinction |
| --- | --- | --- |
| [OpenSelf](https://github.com/Open-Self/Open-Self) | Self-hosted profile and memory system that can automatically reply through WhatsApp, Telegram, and Discord | Message Like Me deliberately ends at an inspectable, unsent draft and does not simulate typing, delay delivery, or operate a messaging account. |
| [Second-Me](https://github.com/mindverse/Second-Me) | Locally trained and hosted "AI self" with memory, model alignment, and a network | Message Like Me does not train a model, construct an identity, or join an agent network. |
| [Doppelganger](https://github.com/NotYuSheng/Doppelganger) | LoRA fine-tuning from chat exports | Its documentation warns that trained models can reproduce private data and other participants' text. Message Like Me keeps analysis in inspectable profiles instead of weights. |
| [Write Like Me](https://github.com/Hiro-Inagawa/write-like-me) | Stylometric profiles for several writing registers with held-out verification | It is useful prior art for measured profiles and verification. Message Like Me focuses on dyadic response context, bubble shape, tempo, and reply behavior. |
| [imessage-exporter](https://github.com/ReagentX/imessage-exporter) | Broad read-only parsing and export of modern Messages features | It is a valuable compatibility reference. Its GPL-3.0 implementation is not copied into this MIT project. |
| [iMessageAnalyzer](https://github.com/dsouzarc/imessageanalyzer) | Conversation statistics, starters, and successive-message analysis | Its fixed time thresholds are prior art, not universal conversational facts. Message Like Me records its own versioned thresholds with results. |
| [iMCP](https://github.com/mattt/iMCP) | Sandboxed native access to Messages and the Contacts framework | It demonstrates a possible future native Contacts boundary. The current CLI uses bounded read-only database snapshots. |
| [imessage-rag](https://github.com/sapochat/imessage-rag) | Local retrieval and question answering over message history | Retrieval of facts from conversations is a different task from measuring the user's outgoing style. |

## Explicit limitations

The research above does not establish that:

- one stable profile captures how a person writes to every contact;
- linguistic similarity implies the same intent, judgment, or factual answer;
- a historical response is the response the user would choose now;
- contact frequency, latency, or warmth reveals relationship quality;
- a model-generated draft was authored, approved, or sent by the user;
- pseudonymous identifiers anonymize a corpus against someone with access to
  the store or installation key;
- local CLI processing controls the data practices of the agent environment
  that opens a study packet; or
- possession of a conversation database grants permission to publish,
  fine-tune on, or impersonate its participants.

The defensible claim is smaller: Message Like Me measures selected historical
messaging behavior, keeps semantic interpretations tied to bounded evidence,
and helps an already-running agent produce an unsent candidate for user review.
