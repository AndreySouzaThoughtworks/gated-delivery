export type TranscriptMessage = { id: string; speaker: "caller" | "agent"; text: string };
export type Props = { messages: TranscriptMessage[] };
