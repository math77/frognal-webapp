/**
 * Gemma instruction-tuned prompt format.
 * https://ai.google.dev/gemma/docs/core/prompt-structure
 *
 * No native system role — system prompt is injected into the first user turn.
 * Seed history (fake prior exchanges) is passed in as the initial `history`
 * from useLLM, giving Gemma immediate personality context before any real message.
 *
 * Rolling window keeps last MAX_HISTORY_PAIRS to stay within maxTokens budget.
 * Note: seed history counts toward the window, so real exchanges replace it
 * gradually — which is fine, the personality is already established by then.
 */

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

const MAX_HISTORY_PAIRS = 5;

export function buildGemmaPrompt(
  systemPrompt: string,
  history: ChatMessage[],
  newUserMessage: string
): string {
  const trimmedHistory = trimHistory(history);

  const allMessages: ChatMessage[] = [
    ...trimmedHistory,
    { role: 'user', content: newUserMessage },
  ];

  let prompt = '';

  allMessages.forEach((msg, i) => {
    if (msg.role === 'user') {
      // System prompt prepended ONLY on the very first user turn
      const content =
        i === 0 ? `${systemPrompt}\n\n${msg.content}` : msg.content;
      prompt += `<start_of_turn>user\n${content}<end_of_turn>\n`;
    } else {
      prompt += `<start_of_turn>model\n${msg.content}<end_of_turn>\n`;
    }
  });

  // Open the model turn — LLM completes from here
  prompt += `<start_of_turn>model\n`;

  return prompt;
}

function trimHistory(history: ChatMessage[]): ChatMessage[] {
  const maxMessages = MAX_HISTORY_PAIRS * 2;
  if (history.length <= maxMessages) return history;
  return history.slice(history.length - maxMessages);
}