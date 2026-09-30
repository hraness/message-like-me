'use client';

import { AgentSetupPrompt, type AgentSetupTarget } from '@hraness/design-kit/react';

import { AGENT_SETUP_PROMPT } from '../../_lib/site';
import { captureInstallCopied } from '../analytics';

function onPromptCopied(): void {
  captureInstallCopied('agent-setup-prompt');
}

export function AgentSetup({ targets }: Readonly<{ targets: readonly AgentSetupTarget[] }>) {
  return <AgentSetupPrompt label="Set up TextButler on your Mac" onCopied={onPromptCopied} prompt={AGENT_SETUP_PROMPT} targets={targets} />;
}
