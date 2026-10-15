# Thinking mode is translated into llama-server fields inside LibreChat

The thinking-mode pill reuses the conversation's existing reasoning effort, and for the local-llm (`Benner`) endpoint only, LibreChat's backend rewrites that value into llama-server's own request fields (`chat_template_kwargs.enable_thinking` and `thinking_budget_tokens`) with the budgets read from `librechat.yaml`. We did this because Qwen3.5-9B's chat template ignores the standard `reasoning_effort` field (tested 2026-10-14 against llama.cpp b11149: `reasoning_effort: "low"` still produced ~1,350 reasoning tokens, while `thinking_budget_tokens: 64` was honoured), so sending the OpenAI-standard field alone does nothing.

## Considered Options

- **Translating proxy in local-llm** in front of llama-server, so every client could send plain `reasoning_effort`. Rejected for now: it adds a third process to start and keep running, for a single client. Revisit if a second client (the local-llm chat REPL, a coding agent) needs the same mapping.
- **A separate thinking-mode field** carried end to end. Rejected: it would duplicate reasoning effort, which LibreChat already persists per conversation and already shows in the side panel.

## Consequences

- LibreChat now contains llama-server-specific field names, scoped to one custom endpoint. Pointing `Benner` at a different engine (Ollama, vLLM) means changing this translation.
- Title requests bypass the conversation's mode and always send thinking off.
