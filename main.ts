import {
  initChatModel,
  SystemMessage,
  HumanMessage,
  AIMessage,
  BaseMessage,
} from "langchain";
import {
  MemorySaver,
  StateGraph,
  START,
  END,
  Annotation,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { writeFile, appendFile } from "node:fs/promises";
import { startUI, getTopic, RunLLM_withUIsync, showVerdictUI } from "./ui.tsx";

const llm = await initChatModel("ollama:llama3.1:8b", {
  baseUrl: "https://8b949900e22d.ngrok-free.app/",
  temperature: 1,
  numPredict: 600,
  configurableFields: ["format"],
});

const checkpointer = new MemorySaver();

const config = {
  configurable: { thread_id: "1" },
};

// state schema with default values
const StateAnnotation = Annotation.Root({
  topic: Annotation<string>({
    value: (_: string, updated: string) => updated,
  }),
  round: Annotation<number>({
    value: (_: number, updated: number) => updated,
    default: () => 1,
  }),
  sub_round: Annotation<number>({
    value: (_: number, updated: number) => updated,
    default: () => 1,
  }),
  max_rounds: Annotation<number>({
    value: (_: number, updated: number) => updated,
    default: () => 3,
  }),
  max_sub_rounds: Annotation<number>({
    value: (_: number, updated: number) => updated,
    default: () => 3,
  }),
  ...MessagesAnnotation.spec,
});

type State = typeof StateAnnotation.State;

// base System prompts for both sides
const systemPrompts = [
  // PROPOSITION
  `You are the PROPOSITION side in a formal debate.
   Your goal: Argue IN FAVOR of the motion.

   CORE RULES:
   1. **No Hallucinations:** Do not invent specific names, dates, or studies. Use logical reasoning and general principles (e.g., "Economic supply and demand dictates...").
   2. **Tone:** Professional, assertive, and fast-paced. Do not be overly polite. Do not say "Thank you for that point." Instead, say "The opponent fails to realize..."
   3. **Consistency:** Never agree with the opposition's core premise. Never admit defeat.

   FORMAT:
   - Use Markdown headers (e.g., **Argument 1**) for clarity.
   - Keep your response under 120 words.
   - Make every word count. No filler sentences.`,

  // OPPOSITION
  `You are the OPPOSITION side in a formal debate.
   Your goal: Argue AGAINST the motion.

   CORE RULES:
   1. **No Hallucinations:** Do not invent specific names, dates, or studies. Use logical reasoning and general principles.
   2. **Tone:** Critical, sharp, and analytical. Do not be overly polite. Do not say "I agree with my opponent." Instead, say "My opponent's logic is flawed because..."
   3. **Strategy:** You do not need to prove the status quo is perfect; you just need to prove the Proposition's plan is worse/ineffective.

   FORMAT:
   - Use Markdown headers (e.g., **Counter 1**) for clarity.
   - Keep your response under 120 words.
   - Make every word count. No filler sentences.`,
];

// Round prompts
const roundPrompts = [
  // ROUND 1: CONSTRUCTIVE
  `
   CURRENT PHASE: ROUND 1 (CONSTRUCTIVE)
   - **Goal:** Build your foundation.
   - **Task:** Introduce your stance and present exactly 2 strong, distinct arguments.
   - **Constraint:** Do NOT attack the opponent yet (unless you are Opposition speaking second). Focus on your own case.
   - **Structure:** 1. Introduction (1 sentence)
     2. Argument 1 (Claim + Logic)
     3. Argument 2 (Claim + Logic)
  `,

  // ROUND 2: REBUTTAL
  `
   CURRENT PHASE: ROUND 2 (REBUTTAL)
   - **Goal:** Attack and Defend.
   - **Task:** Go line-by-line through the opponent's last speech and refute their logic.
   - **CRITICAL RULE:** **DO NOT** introduce new constructive arguments. You can only provide new logic/evidence to support *existing* points.
   - **Structure:**
     1. "They argued [X], but this is flawed because..."
     2. "Regarding my point on [Y], their attack fails because..."
  `,

  // ROUND 3: CLOSING / WHIP
  `CURRENT PHASE: ROUND 3 (CLOSING)

**GOAL:** You are the "Closing Whip." Your ONLY job is to prove to the Judge that **YOUR SIDE WON**.
- **Legacy Instruction:** Do NOT be a neutral reporter. Do NOT say "Both sides raised good points." 
- **Task:** Explain why the "World of the Proposition" is better/worse than the "World of the Opposition" (depending on your side).

**CRITICAL CONSTRAINTS:**
1. **EXTREME BIAS REQUIRED:** You must argue that the opponent's worldview is dangerous or flawed. Never concede a point in this round.
2. **NO NEW ARGUMENTS:** Do not introduce new evidence. Weigh the existing arguments.
3. **HEADER BAN:** DO NOT use "Rebuttal", "Counter", or "Argument" in headers. Use headers like "The Main Clash" or "Why We Win".
4. **NO COPYING:** Do not repeat the opponent's "Main Clash" text. You must phrase the conflict in a way that favors YOUR side.

**REQUIRED STRUCTURE:**
1. **The Main Clash:** Define the core philosophical disagreement (e.g., "This is a choice between Freedom vs. Tyranny").
2. **Impact Calculus:** Use "Even If" logic. (e.g., "Even if their plan saves money, it costs us our humanity, which is a price too high to pay").
3. **Final Hook:** A memorable concluding sentence.`,
];

// Dynamic System prompt based on side and round
function SystemPrompt(topic: string, side: number, round: number): string {
  const basePrompt = side === 0 ? systemPrompts[0] : systemPrompts[1];

  const roundPrompt = roundPrompts[round - 1];

  // return combined final prompt
  return `${basePrompt?.trim()}\nTopic - ${topic}\n${roundPrompt?.trim()}\n`;
}

/* 
Most chat models train on Human-Ai chat pattern.
Our Opposition node appends an AIMessage to the message list so the for the next round the chat model will see an AIMessage as the last message and will respond with an empty string. to fix this we will swap the reverse the message types so the chat model sees a HumanMessage as the last message so it will respond with with the role provided by system prompt.
*/
const Message_List_For_Proposition = async (messages: BaseMessage[]) => {
  let newArray = messages.map((message) => {
    if (message._getType() === "human") {
      return new AIMessage(message.content);
    } else {
      return new HumanMessage(message.content);
    }
  });

  return newArray;
};

// Proposition speech
const Proposition = async (state: State): Promise<Partial<State>> => {
  const { topic, round, sub_round, messages } = state;

  let transformed_messages = await Message_List_For_Proposition(messages);

  const messages_for_llm: BaseMessage[] = [
    new SystemMessage(SystemPrompt(topic, 0, round)),
  ];

  // Conditionally add the next message
  if (round == 1 && sub_round == 1) {
    messages_for_llm.push(new HumanMessage("Start your debate"));
  } else {
    messages_for_llm.push(...transformed_messages);
  }

  /*await appendFile(
    "fest.txt",
    `\n${round} ${sub_round}\n${JSON.stringify(messages_for_llm)}\n`,
  );*/

  // Pass the complete, flat array to invoke
  const llm_res = await RunLLM_withUIsync({
    side: "PROPOSITION",
    round: round,
    messages: messages_for_llm,
    llm: llm,
  });

  // Proposition's speech as a HumanMessage
  let Message_To_Store = new HumanMessage(llm_res);

  return {
    messages: [Message_To_Store],
  };
};

// Opposition speech
const Opposition = async (state: State): Promise<Partial<State>> => {
  const { topic, round, sub_round, max_sub_rounds, messages } = state;

  const messages_for_llm: BaseMessage[] = [
    new SystemMessage(SystemPrompt(topic, 0, round)),
    ...messages,
  ];

  const llm_res = await RunLLM_withUIsync({
    side: "OPPOSITION",
    round: round,
    messages: messages_for_llm,
    llm: llm,
  });

  // Opposition's speech as a AIMessage
  let Message_To_Store = new AIMessage(llm_res);

  return {
    messages: [Message_To_Store],
    // increase round if only all sub-rounds are done
    round: sub_round == max_sub_rounds ? round + 1 : round,
    // increase sub-round if not done and reset if done
    sub_round: sub_round >= max_sub_rounds ? 1 : sub_round + 1,
  };
};

// judge
const Judge = async (state: State) => {
  const { messages } = state;

  const judgePrompt = `
    You are an expert Debate Judge. 
    Analyze the debate transcript below.
    
    Tasks:
    1. Assign a score (0-10) to Proposition.
    2. Assign a score (0-10) to Opposition.
    3. Declare the WINNER based on who had better logical impacts (not who was nicer).
    4. Provide a 3-4-sentence reason.
    
    Output JSON format only:
    { "prop_score": number, "opp_score": number, "winner": "Proposition" | "Opposition", "reason": "string" }
  `;

  const llm_res = await llm.invoke(
    [
      new SystemMessage(judgePrompt),
      ...messages,
      new HumanMessage(
        "The debate has concluded. Based on the transcript above, generate your verdict in JSON format now.",
      ),
    ],
    {
      configurable: {
        format: "json",
      },
    },
  );

  showVerdictUI(llm_res.content as string);
};

// check if debate should end
const Check_Round = (state: State): string => {
  const { round, sub_round, max_rounds, max_sub_rounds } = state;

  // End workflow if sub-rounds and rounds are done
  if (sub_round <= max_sub_rounds && round <= max_rounds) {
    return "Proposition";
  } else {
    return "Judge";
  }
};

// main workflow
const graph = new StateGraph(StateAnnotation)
  .addNode("Proposition", Proposition)
  .addNode("Opposition", Opposition)
  .addNode("Judge", Judge)
  .addEdge(START, "Proposition")
  .addEdge("Proposition", "Opposition")
  .addConditionalEdges("Opposition", Check_Round)
  .addEdge("Judge", END)
  .compile({ checkpointer });

startUI();

const debateTopic = await getTopic();

let state = await graph.invoke(
  { topic: debateTopic, max_rounds: 3, max_sub_rounds: 3 },
  config,
);

// save debate script to file
async function writeToFile(data: BaseMessage[]) {
  let content = "";
  data.forEach((msg) => {
    if (msg._getType() == "human") {
      content += "Proposition: ";
    } else {
      content += "\nOpposition: ";
    }
    content += "\n" + msg.content + "\n";
  });
  writeFile(`${Date.now()}.txt`, String(content));
}

// saves the debate script to a new file
await writeToFile(state.messages);
