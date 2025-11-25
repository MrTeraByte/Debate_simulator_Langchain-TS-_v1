import { useState, useEffect } from "react";
import { Box, Text, Static, render } from "ink";
import TextInput from "ink-text-input";
import { EventEmitter } from "events";

// event listener
const uiEvents = new EventEmitter();

const EVENTS = {
  TOPIC_SUBMIT: "topic_submit", // when user submits topic
  START_TURN: "start_turn", // When LLM starts thinking
  STREAM_TOKEN: "stream_token", // When a chunk arrives
  END_TURN: "end_turn", // When the message is done
  SHOW_VERDICT: "show_verdict", // when debate is over
};

// Topic selector UI
const TopicSelector = ({ onSubmit }: { onSubmit: (t: string) => void }) => {
  const [query, setQuery] = useState("");

  return (
    <Box flexDirection="column" padding={1}>
      <Box
        borderStyle="round"
        borderColor="blue"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="blue">
          DEBATE SIMULATOR
        </Text>
      </Box>
      <Text>Enter a topic:</Text>
      <Box borderStyle="single" borderColor="gray">
        <Text color="green">❯ </Text>
        <TextInput
          value={query}
          onChange={setQuery}
          onSubmit={onSubmit}
          placeholder="e.g. Should AI replace programmers?"
        />
      </Box>
    </Box>
  );
};

// function to get topic from UI
export const getTopic = () => {
  return new Promise<string>((resolve) => {
    uiEvents.once(EVENTS.TOPIC_SUBMIT, (topic) => {
      resolve(topic);
    });
  });
};

type Message = {
  id: number;
  side: string;
  content: string;
  round: number;
};

const ChatBubble = ({
  side,
  round,
  content,
  isThinking,
}: Omit<Message, "id"> & { isThinking?: boolean }) => {
  const isProp = side === "PROPOSITION";
  const color = isProp ? "cyan" : "magenta";

  //const safeWidth = (process.stdout.columns || 80) - 4;

  return (
    <Box
      width={"100%"}
      flexDirection="column"
      alignItems={side == "PROPOSITION" ? "flex-end" : "flex-start"}
      marginBottom={1}
    >
      <Text bold color={color}>
        {side} | Round {round}
      </Text>
      <Box borderStyle="round" borderColor={color} paddingX={1} width={50}>
        <Text>{isThinking ? "Thinking..." : content}</Text>
      </Box>
    </Box>
  );
};

// main UI component
const UI = () => {
  const [history, setHistory] = useState<Message[]>([]);
  const [currentStream, setCurrentStream] = useState("");
  const [activeBubble, setActiveBubble] = useState<{
    side: string;
    round: number;
  } | null>(null);
  const [verdict, setVerdict] = useState<VerdictData | null>(null);

  // Handler for when user presses Enter
  const handleTopicSubmit = (newTopic: string) => {
    // Adding topic as first message in history
    setHistory((prev) => [
      ...prev,
      {
        id: Date.now(),
        side: "user",
        round: 0,
        content: newTopic,
      },
    ]);

    // send topic to event listener
    uiEvents.emit(EVENTS.TOPIC_SUBMIT, newTopic);
  };

  useEffect(() => {
    // 1. Start of a turn
    const onStart = ({ side, round }: { side: string; round: number }) => {
      setActiveBubble({ side, round });
      setCurrentStream("");
    };

    // 2. Incoming Token
    const onToken = (token: string) => {
      setCurrentStream((prev) => prev + token);
    };

    // 3. End of turn
    const onEnd = () => {
      if (activeBubble) {
        setHistory((prev) => [
          ...prev,
          {
            id: Date.now(),
            side: activeBubble.side,
            round: activeBubble.round,
            content: currentStream,
          },
        ]);
      }
      setActiveBubble(null);
      setCurrentStream("");
    };

    // 4. Show Verdict
    const onVerdict = (data: VerdictData) => {
      setVerdict(data);
    };

    // Subscribe
    uiEvents.on(EVENTS.START_TURN, onStart);
    uiEvents.on(EVENTS.STREAM_TOKEN, onToken);
    uiEvents.on(EVENTS.END_TURN, onEnd);
    uiEvents.on(EVENTS.SHOW_VERDICT, onVerdict);

    // Cleanup
    return () => {
      uiEvents.off(EVENTS.START_TURN, onStart);
      uiEvents.off(EVENTS.STREAM_TOKEN, onToken);
      uiEvents.off(EVENTS.END_TURN, onEnd);
      uiEvents.off(EVENTS.SHOW_VERDICT, onVerdict);
    };
  }, [activeBubble, currentStream]);

  if (history.length === 0) {
    return <TopicSelector onSubmit={handleTopicSubmit} />;
  }

  return (
    <Box flexDirection="column" padding={1} width="100%">
      {/* Static History */}
      <Static items={history} style={{ width: "100%", paddingRight: 2 }}>
        {(msg) => {
          if (msg.round == 0) {
            return (
              <Box
                borderStyle="round"
                borderColor="blue"
                flexDirection="column"
                alignItems="flex-start"
                width="100%"
                paddingX={1}
                marginBottom={1}
                key="header"
              >
                <Text color="gray">DEBATE TOPIC</Text>
                <Text bold color="white" wrap="wrap">
                  {msg.content.toUpperCase()}
                </Text>
              </Box>
            );
          } else {
            return (
              <ChatBubble
                key={msg.id}
                side={msg.side}
                round={msg.round}
                content={msg.content}
              />
            );
          }
        }}
      </Static>

      {/* Active Streaming Bubble */}
      {activeBubble && (
        <ChatBubble
          side={activeBubble.side}
          round={activeBubble.round}
          content={currentStream}
          isThinking={currentStream.length === 0}
        />
      )}

      {/* 3. Render Verdict */}
      {verdict && <VerdictDisplay data={verdict} />}
    </Box>
  );
};

export function startUI() {
  const instance = render(<UI />);
  return instance;
}

type VerdictData = {
  prop_score: number;
  opp_score: number;
  winner: "Proposition" | "Opposition";
  reason: string;
};


// Verdict UI
const VerdictDisplay = ({ data }: { data: VerdictData }) => {
  const isPropWinner = data.winner === "Proposition";
  const winnerColor = isPropWinner ? "cyan" : "magenta";

  // visual bars
  const renderBar = (score: number, color: string) => {
    const bars = "█".repeat(score);
    const empty = "░".repeat(10 - score);
    return (
      <Text color={color}>
        {bars}
        {empty} {score}/10
      </Text>
    );
  };

  return (
    <Box
      borderStyle="double"
      borderColor="blue"
      flexDirection="column"
      alignSelf="center"
      paddingX={2}
      paddingY={1}
      marginTop={1}
      width="100%"
    >
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold underline color="blue">
          FINAL VERDICT
        </Text>
      </Box>

      {/* Winner Announcement */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text>The Winner is:</Text>
        <Text bold color={winnerColor} backgroundColor="black">
          ✨ {data.winner.toUpperCase()} ✨
        </Text>
      </Box>

      {/* Scoreboard */}
      <Box flexDirection="column" marginBottom={1}>
        <Text underline>Scorecard:</Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="cyan">Proposition:</Text>
          {renderBar(data.prop_score, "cyan")}
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="magenta">Opposition: </Text>
          {renderBar(data.opp_score, "magenta")}
        </Box>
      </Box>

      {/* Reasoning */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Text bold>Judge's Reasoning:</Text>
        <Text italic wrap="wrap">
          "{data.reason}"
        </Text>
      </Box>
    </Box>
  );
};

// function to show verdict
export function showVerdictUI(data: string) {
  uiEvents.emit(EVENTS.SHOW_VERDICT, JSON.parse(data));
}

// function to run LLM and sync with UI
export async function RunLLM_withUIsync({
  side,
  messages,
  round,
  llm,
}: {
  side: string;
  messages: any;
  round: number;
  llm: any;
}) {
  // pops the new chat bubble, shows thinking first
  uiEvents.emit(EVENTS.START_TURN, { side, round });

  if (!llm) throw new Error("LLM instance is missing!");

  const llm_res = await llm.stream(messages);

  let fullResponse = "";

  for await (const chunk of llm_res) {
    const token = chunk.content as string;

    if (token) {
      //streams token to ui
      uiEvents.emit(EVENTS.STREAM_TOKEN, token);
      fullResponse += token;
    }
  }

  //ends token streaming
  uiEvents.emit(EVENTS.END_TURN);

  // return to langchain
  return fullResponse;
}
