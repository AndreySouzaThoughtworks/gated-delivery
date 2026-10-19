import { useRef } from "react";
import { EmptyState } from "./EmptyState";
import { Message } from "./Message";
import type { Props } from "./types";

export function TranscriptPanel({ messages }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  if (messages.length === 0) return <EmptyState />;
  return <ul ref={listRef}>{messages.map((m) => <Message key={m.id} {...m} />)}</ul>;
}
