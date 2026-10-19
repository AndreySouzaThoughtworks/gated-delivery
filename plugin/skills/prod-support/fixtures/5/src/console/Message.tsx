import type { TranscriptMessage } from "./types";

export function Message({ speaker, text }: TranscriptMessage) {
  return <li data-speaker={speaker}>{text}</li>;
}
