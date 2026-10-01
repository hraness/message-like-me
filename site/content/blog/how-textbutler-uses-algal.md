A helpful reply depends on the relationship. One friend wants a short answer; another needs the context behind it. TextButler keeps reply guidance for each contact separately and uses ALGAL to organize an optional process for trying changes against past conversations.

The useful question is specific: does a proposed change produce better replies for these examples while preserving the settings you chose?

## Separate style from permission

A contact’s reply plan describes guidance, tone, humor, how much context to read and how long a reply should be. You also provide standing notes about the relationship and what is off-limits.

Learning can propose changes to the reply guidance. It cannot change the recipient, the model account, disclosure settings or the tools you enabled. Your standing relationship instructions stay under your control.

For example, a candidate might favor shorter answers after a contact repeatedly asks for the main point. That is a change to how the assistant writes. It does not give the assistant permission to message another person or search the web.

## Compare the proposal with the current plan

[ALGAL](https://algal.computer) runs agent programs as a sequence of steps with declared limits. TextButler uses it to keep composing a reply, proposing a change and evaluating that change as distinct steps.

When optional learning is configured, TextButler can use a contact’s follow-up messages to propose revised guidance. Before replacing the current plan, it replays two past cases from that contact with both plans.

A model judge compares the replies without being told which plan is the current one. A candidate must be marked safe on both cases, score no lower on either, and improve the average by a required margin. If the owner changes the plan or the relevant memory during evaluation, that evaluation cannot overwrite the change.

The process leaves the current plan in place when the comparison fails. Learning starts off by default and requires a separately configured learning model.

## Understand what the comparison measures

Two cases are a small sample, and the judge is another model. A better score on those examples is evidence about that comparison, not a measurement of improvement in future conversations.

The replay also runs without tools. It can compare the words generated from the supplied context, but it does not test whether a web search was useful or whether a message was delivered. Those questions need their own checks.

These distinctions make the result usable. You can inspect a concrete proposed change and the examples behind it without treating a score as a general claim that the assistant has become better.

## Keep memory inspectable

A remembered preference should point back to the conversation that supports it. TextButler can keep contact-specific notes with their sources, and you can inspect or clear that memory from the command line.

A note and a reply plan serve different purposes. The note records something relevant to the relationship. The plan guides how the assistant responds. Neither changes the account connection or enables automatic replies.

If a learned change is unhelpful, pause automatic replies and restore an earlier learned plan from the current owner configuration. Editing the plan yourself also invalidates pending work based on the older settings.

## Begin with guidance you can explain

Write a few useful instructions for one contact before turning on learning: how concise to be, which context matters, and which decisions should stay with you. Review actual drafts to see whether those instructions help.

Optional adaptation is easier to judge when the starting point is understandable. The [architecture guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/architecture.md) covers the learning process and owner controls. [Introducing TextButler](/blog/introducing-textbutler) explains how those controls fit into a conversation.
