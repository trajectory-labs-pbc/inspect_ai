"""Reasoning from non-Anthropic models survives an Anthropic API scaffold."""

import json
from typing import Any

import pytest
from google.genai.types import Candidate, Content, FunctionCall, Part

from inspect_ai._util.content import ContentReasoning, ContentText
from inspect_ai.agent._bridge.anthropic_api_impl import (
    FOREIGN_REASONING_PREFIX,
    messages_from_anthropic_input,
    restore_foreign_reasoning,
    scaffold_assistant_message,
)
from inspect_ai.model._chat_message import ChatMessageAssistant
from inspect_ai.model._providers.anthropic import (
    assistant_message_blocks,
    init_sample_anthropic_assistant_internal,
)
from inspect_ai.model._providers.google import (
    completion_choice_from_candidate,
)
from inspect_ai.model._providers.google import (
    content as google_content,
)
from inspect_ai.tool._tool_info import ToolInfo
from inspect_ai.tool._tool_params import ToolParams

_NO_CLIENT: Any = None


def _call(id: str, name: str, signature: bytes | None = None) -> Part:
    return Part(
        function_call=FunctionCall(id=id, name=name, args={}),
        thought_signature=signature,
    )


def _summarize(parts: list[Part]) -> list[tuple[str, bytes | None]]:
    summary: list[tuple[str, bytes | None]] = []
    for part in parts:
        if part.function_call is not None:
            kind = f"call:{part.function_call.name}"
        elif part.thought:
            kind = f"thought:{part.text}"
        else:
            kind = f"text:{part.text}"
        summary.append((kind, part.thought_signature))
    return summary


async def _scaffold_round_trip(
    message: ChatMessageAssistant,
) -> tuple[list[dict[str, Any]], ChatMessageAssistant]:
    """Send `message` to a scaffold as Anthropic blocks and read it back."""
    blocks = await assistant_message_blocks(scaffold_assistant_message(message))
    # the scaffold sees (and echoes back) plain JSON
    echoed = json.loads(json.dumps([b.model_dump(exclude_none=True) for b in blocks]))
    history: list[Any] = [
        {"role": "user", "content": "go"},
        {"role": "assistant", "content": echoed},
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": b["id"], "content": "ok"}
                for b in echoed
                if b["type"] == "tool_use"
            ],
        },
    ]
    tools: list[Any] = [
        ToolInfo(name=name, description=name, parameters=ToolParams())
        for name in ("bash", "read")
    ]
    messages = await messages_from_anthropic_input(history, tools)
    replayed = messages[1]
    assert isinstance(replayed, ChatMessageAssistant)
    return echoed, replayed


@pytest.mark.parametrize(
    "parts",
    [
        pytest.param([_call("c1", "bash", b"sig-1")], id="signed-call"),
        pytest.param(
            [
                Part(text="list the files", thought=True),
                Part(text="Listing.", thought_signature=b"sig-text"),
                _call("c1", "bash", b"sig-1"),
                _call("c2", "read"),
            ],
            id="thought-text-parallel-calls",
        ),
        pytest.param(
            [Part(text="plan", thought=True), _call("c1", "bash", b"sig-1")],
            id="unsigned-thought-then-call",
        ),
    ],
)
@pytest.mark.anyio
async def test_gemini_request_after_scaffold_matches_native(parts: list[Part]) -> None:
    init_sample_anthropic_assistant_internal()
    message = completion_choice_from_candidate(
        "gemini-3-pro", Candidate(content=Content(role="model", parts=parts))
    ).message

    _, replayed = await _scaffold_round_trip(message)

    # the client is only used to upload media, which these messages have none of
    native = await google_content(_NO_CLIENT, message)
    bridged = await google_content(_NO_CLIENT, replayed)
    assert native.parts is not None and bridged.parts is not None
    assert _summarize(bridged.parts) == _summarize(native.parts)
    assert ("call:bash", b"sig-1") in _summarize(bridged.parts)


@pytest.mark.anyio
async def test_foreign_reasoning_is_sent_as_thinking_blocks() -> None:
    init_sample_anthropic_assistant_internal()
    message = completion_choice_from_candidate(
        "gemini-3-pro",
        Candidate(
            content=Content(
                role="model",
                parts=[
                    Part(text="list the files", thought=True),
                    _call("c1", "bash", b"sig-1"),
                ],
            )
        ),
    ).message

    echoed, _ = await _scaffold_round_trip(message)

    thinking = [b for b in echoed if b["type"] == "thinking"]
    assert [b["thinking"] for b in thinking] == ["list the files", ""]
    assert all(b["signature"].startswith(FOREIGN_REASONING_PREFIX) for b in thinking)
    # no reasoning leaks into the visible text
    assert [b for b in echoed if b["type"] == "text"] == []


@pytest.mark.anyio
async def test_anthropic_thinking_is_unchanged() -> None:
    init_sample_anthropic_assistant_internal()
    history: list[Any] = [
        {"role": "user", "content": "go"},
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "hmm", "signature": "anthropic-sig"},
                {"type": "redacted_thinking", "data": "anthropic-data"},
                {"type": "text", "text": "done"},
            ],
        },
    ]
    message = (await messages_from_anthropic_input(history, []))[1]
    assert isinstance(message, ChatMessageAssistant)

    blocks = await assistant_message_blocks(scaffold_assistant_message(message))

    assert [b.model_dump(exclude_none=True) for b in blocks] == history[1]["content"]


def test_restore_leaves_other_content_alone() -> None:
    text = ContentText(text=f"{FOREIGN_REASONING_PREFIX}not reasoning")
    assert restore_foreign_reasoning(text) is text
    anthropic = ContentReasoning(reasoning="sig", summary="hmm", redacted=True)
    assert restore_foreign_reasoning(anthropic) is anthropic
    corrupt = ContentReasoning(
        reasoning=f"{FOREIGN_REASONING_PREFIX}!!!", summary="", redacted=True
    )
    assert restore_foreign_reasoning(corrupt) is corrupt
