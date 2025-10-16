import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

const chat = new ChatOpenAI(
  {
    model: 'deepseek/deepseek-r1:free',
    temperature: 0.8,
    streaming: true,
    apiKey: process.env.OPEN_ROUTER_KEY!,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
    },
  },
);

const response = await chat.invoke([
  new SystemMessage('You are a rookie business.'),
  new HumanMessage('Hello, how are you?'),
]);

console.log(response.content);