import OpenAI from 'openai';
import { outputHint,outputSchema, SYSTEM_POLICY } from './contracts.js';
import {zodTextFormat} from 'openai/helpers/zod';
import type { NodeConfig, SourceExcerpt } from './types.js';

export interface LlmResult { text: string; json?: Record<string, unknown>; model: string; }

export class LlmClient {
  private client?: OpenAI;
  constructor(private apiKey = process.env.OPENAI_API_KEY, private defaultModel = process.env.OPENAI_CHAT_MODEL ?? 'gpt-5.6-terra', client?: OpenAI) {
    if (client) this.client = client;
    else if (apiKey) this.client = new OpenAI({ apiKey, timeout:60_000, maxRetries:2 });
  }
  get available() { return Boolean(this.client); }
  async run(node: NodeConfig, input: Record<string, unknown>, sources: SourceExcerpt[] = [], runtimeInstructions = ''): Promise<LlmResult> {
    const model = node.model?.name ?? this.defaultModel;
    const sourceBlock = sources.map((s) => `[${s.id}] ${s.title ?? ''} ${s.url}\n${s.text}`).join('\n\n');
    const prompt = SYSTEM_POLICY + '\n' + node.instructions + '\n' + node.rules.join('\n') + (runtimeInstructions?'\nInstrucciones de orquestación protegidas de esta ejecución:\n'+runtimeInstructions:'') + '\nEjemplos: ' + JSON.stringify(node.examples ?? []) + '\nDevuelve exclusivamente JSON: ' + outputHint(node.id) + '\nuserMessageIds solo puede incluir ids literales de mensajes con role=user de conversation. Si no hay mensajes user, debe ser []. No confundas ids de fuentes con ids de mensajes. sourceIds solo puede incluir ids literales de officialSources. No incluyas ids técnicos en message: la aplicación renderiza las citas. Usa strings vacíos en campos de texto sin contenido, nunca null.';
    if (!this.client) return { model, text: 'No hay OPENAI_API_KEY configurada. He pausado esta sesión; configura la clave para continuar.' };
    const response = await (this.client.responses.create as any)({ model, instructions: prompt, input: 'Return JSON. Context data: '+JSON.stringify({context:input,officialSources:sourceBlock}), reasoning:node.model?.reasoning_effort ? {effort:node.model.reasoning_effort}:undefined, text:{format:zodTextFormat(outputSchema(node.id),'node_output')}, max_output_tokens:6000, store: false });
    const text = response.output_text ?? '';
    const json = JSON.parse(text) as Record<string, unknown>;
    return { text, json, model };
  }
  async transcribe(audio: Buffer, filename = 'voice.ogg'): Promise<string> {
    if (!this.client) throw new Error('OPENAI_API_KEY is required for voice transcription');
    const file = await OpenAI.toFile(audio, filename);
    const result = await this.client.audio.transcriptions.create({ file, model: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-transcribe', language: 'es' } as any);
    return (result as any).text ?? '';
  }
  async embed(text: string): Promise<number[] | undefined> {
    if (!this.client) return undefined;
    const result = await this.client.embeddings.create({ model: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small', input: text });
    return result.data[0]?.embedding;
  }
}
