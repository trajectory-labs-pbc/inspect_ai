import pytest
from anthropic.types import Message, RefusalStopDetails, Usage
from anthropic.types.beta import BetaRefusalStopDetails

from inspect_ai.agent._bridge.anthropic_api_impl import (
    anthropic_stop_details,
    anthropic_system_to_text,
    messages_from_anthropic_input,
)
from inspect_ai.model._chat_message import (
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageUser,
)


@pytest.mark.anyio
async def test_inline_system_role_str_content() -> None:
    """Claude 4.8+ clients may send role="system" inside the messages array."""
    messages = await messages_from_anthropic_input(
        [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
            {"role": "system", "content": "<system-reminder>note</system-reminder>"},
            {"role": "user", "content": "continue"},
        ],
        tools=[],
    )
    assert [type(m) for m in messages] == [
        ChatMessageUser,
        ChatMessageAssistant,
        ChatMessageSystem,
        ChatMessageUser,
    ]
    assert messages[2].text == "<system-reminder>note</system-reminder>"


@pytest.mark.anyio
async def test_inline_system_role_block_content() -> None:
    messages = await messages_from_anthropic_input(
        [
            {"role": "user", "content": "hello"},
            {
                "role": "system",
                "content": [{"type": "text", "text": "reminder"}],
            },
        ],
        tools=[],
    )
    assert isinstance(messages[1], ChatMessageSystem)
    assert messages[1].text == "reminder"


def test_anthropic_system_to_text() -> None:
    assert anthropic_system_to_text("plain") == "plain"
    assert (
        anthropic_system_to_text(
            [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]
        )
        == "a\n\nb"
    )


def test_anthropic_stop_details_refusal() -> None:
    details = anthropic_stop_details("content_filter", beta=False)
    assert isinstance(details, RefusalStopDetails)
    assert details.type == "refusal"

    beta_details = anthropic_stop_details("content_filter", beta=True)
    assert isinstance(beta_details, BetaRefusalStopDetails)
    assert beta_details.type == "refusal"


def test_anthropic_stop_details_non_refusal() -> None:
    for reason in ("stop", "max_tokens", "model_length", "tool_calls", "unknown"):
        assert anthropic_stop_details(reason, beta=False) is None


def test_refusal_message_dump_carries_stop_details() -> None:
    r"""The bridge transports stop_details via model_dump(mode=\"json\")."""
    message = Message.model_construct(
        id="msg_test",
        content=[],
        model="test-model",
        role="assistant",
        stop_reason="refusal",
        stop_details=anthropic_stop_details("content_filter", beta=False),
        type="message",
        usage=Usage(input_tokens=0, output_tokens=0),
    )
    dumped = message.model_dump(mode="json", warnings=False)
    assert dumped["stop_reason"] == "refusal"
    assert dumped["stop_details"] == {
        "type": "refusal",
        "category": None,
        "explanation": None,
    }


def test_bridge_service_maps_provider_api_error_to_sentinel() -> None:
    """Provider API errors map to a sentinel; non-API errors still raise (proxy fails hard)."""
    import anthropic
    import httpx
    import openai

    from inspect_ai.agent._bridge.sandbox.service import (
        _BRIDGE_ERROR_KEY,
        _api_error_result,
    )

    req = httpx.Request("POST", "https://proxy.example/v1/messages")
    body = {
        "type": "error",
        "error": {
            "type": "authentication_error",
            "message": "Invalid API key or credential",
        },
    }
    auth_err = anthropic.AuthenticationError(
        "401", response=httpx.Response(401, request=req, json=body), body=body
    )
    result = _api_error_result(auth_err)
    assert result is not None
    assert result[_BRIDGE_ERROR_KEY]["status"] == 401
    assert result[_BRIDGE_ERROR_KEY]["body"]["error"]["type"] == "authentication_error"

    obody = {"error": {"type": "rate_limit_error", "message": "slow down"}}
    rate_err = openai.RateLimitError(
        "429",
        response=httpx.Response(
            429, request=httpx.Request("POST", "https://x"), json=obody
        ),
        body=obody,
    )
    rate_result = _api_error_result(rate_err)
    assert rate_result is not None
    assert rate_result[_BRIDGE_ERROR_KEY]["status"] == 429

    conn_result = _api_error_result(anthropic.APIConnectionError(request=req))
    assert conn_result is not None
    assert conn_result[_BRIDGE_ERROR_KEY]["status"] == 503

    assert _api_error_result(ValueError("a genuine bridge bug")) is None
