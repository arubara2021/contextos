import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../shared/Icon";

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (!coarse) textareaRef.current?.focus();
  }, []);

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 170)}px`;
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    requestAnimationFrame(autosize);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="composer-shell">
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        placeholder={disabled ? "the mind is answering…" : "Ask your archive…"}
        aria-label="Message"
        aria-busy={disabled}
        inputMode="text"
        enterKeyHint="send"
        autoComplete="off"
        autoCapitalize="sentences"
        onChange={(event) => {
          setText(event.target.value);
          autosize();
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        className={`send-orb ${disabled
          ? "animate-[breathe_1.8s_ease-in-out_infinite] !opacity-90 !filter-none"
          : ""
          }`}
        onClick={submit}
        disabled={disabled || !hasText}
        aria-label={
          disabled ? "ContextOS is reaching into memory" : "Send message"
        }
        title={disabled ? "Reaching…" : "Send"}
      >
        <Icon name="send" size={18} />
      </button>
    </div>
  );
}