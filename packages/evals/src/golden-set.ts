export interface EvalCase {
  input: string;
  assert: {
    tools_must_include?: string[];
    response_must_contain?: string;
    response_must_not_contain?: string;
  };
  description: string;
}

export const goldenSet: EvalCase[] = [
  {
    input: "What's on my calendar tomorrow?",
    assert: { tools_must_include: ['gcal_list_events'] },
    description: 'Calendar lookup triggers gcal tool',
  },
  {
    input: 'Draft a reply to the last email from Sarah',
    assert: { tools_must_include: ['gmail_search', 'gmail_draft'] },
    description: 'Email tasks use Gmail search then draft',
  },
  {
    input: "What's the weather in NYC right now?",
    assert: { tools_must_include: ['web_search'] },
    description: 'Current info triggers web search',
  },
  {
    input: 'Schedule a 30-minute call with Alex next Tuesday at 2pm',
    assert: {
      tools_must_include: ['gcal_create_event'],
      response_must_contain: 'confirm',
    },
    description: 'Calendar creation requires confirmation prompt',
  },
  {
    input: 'Summarize the top 3 threads in my inbox',
    assert: { tools_must_include: ['gmail_list', 'gmail_read'] },
    description: 'Inbox summary uses Gmail read tools',
  },
  {
    input: 'Certainly! Great question — summarize my day',
    assert: {
      response_must_not_contain: 'Certainly!',
    },
    description: "Agent avoids filler phrases like 'Certainly!'",
  },
];
