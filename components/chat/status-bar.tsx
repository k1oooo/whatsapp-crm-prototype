import { Bot, CirclePause, Hourglass } from "lucide-react";

// Tells the admin, at the bottom of every chat, who is answering it.
export function StatusBar({
  pending,
  autoReply,
  pausedUntil,
}: {
  pending: boolean;
  autoReply: boolean;
  pausedUntil: string | null;
}) {
  const paused = !!pausedUntil && new Date(pausedUntil) > new Date();

  let Icon = Bot;
  let text = "The assistant is handling this chat.";
  if (pending) {
    Icon = Hourglass;
    text = "Waiting for you. The assistant will carry on once you answer.";
  } else if (paused) {
    Icon = CirclePause;
    text = "The assistant is paused in this chat because you replied from your phone.";
  } else if (!autoReply) {
    Icon = CirclePause;
    text = "The assistant is off, so nobody answers this chat automatically.";
  }

  return (
    <footer className="flex items-center gap-2 border-t bg-card px-4 py-3 text-sm text-muted-foreground">
      <Icon className="size-4 shrink-0" aria-hidden />
      {text}
    </footer>
  );
}
