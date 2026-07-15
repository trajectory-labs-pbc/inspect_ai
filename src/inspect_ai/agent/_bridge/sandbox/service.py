from logging import getLogger  # noqa: E402
from typing import Any, Awaitable, Callable

import anyio
from pydantic import JsonValue

from inspect_ai._util.json import to_json_str_safe
from inspect_ai.model._call_tools import get_tools_info
from inspect_ai.tool._tools._code_execution import CodeExecutionProviders
from inspect_ai.tool._tools._web_search._web_search import WebSearchProviders
from inspect_ai.util._sandbox import SandboxEnvironment, sandbox_service

from ..anthropic_api import inspect_anthropic_api_request
from ..completions import inspect_completions_api_request
from ..google_api import inspect_google_api_request
from ..responses import inspect_responses_api_request
from .types import SandboxAgentBridge

logger = getLogger(__name__)

MODEL_SERVICE = "bridge_model_service"


# Contract with the in-sandbox proxy (see _agent_bridge/proxy.py): a generate_*
# method returns this sentinel (instead of raising) when the underlying model call
# fails with a provider API error, so the proxy can replay the real HTTP status/body
# to the harness rather than exiting the whole model-proxy process. Keep this literal
# in sync with the proxy copies.
_BRIDGE_ERROR_KEY = "__inspect_bridge_error__"

_API_ERROR_TYPES: tuple[type[Exception], ...] | None = None


def _provider_api_error_types() -> tuple[type[Exception], ...]:
    # Provider SDK base error types, resolved once. Used to tell a real provider API
    # error (which we relay to the harness) apart from a genuine bridge bug (which is
    # re-raised and still fails the proxy hard).
    global _API_ERROR_TYPES
    if _API_ERROR_TYPES is None:
        types: list[type[Exception]] = []
        try:
            import anthropic

            types.append(anthropic.APIError)
        except ImportError:
            pass
        try:
            import openai

            types.append(openai.APIError)
        except ImportError:
            pass
        try:
            from google.genai import errors as google_genai_errors

            types.append(google_genai_errors.APIError)
        except ImportError:
            pass
        _API_ERROR_TYPES = tuple(types)
    return _API_ERROR_TYPES


def _api_error_result(ex: Exception) -> dict[str, JsonValue] | None:
    """Map a provider API error to a sentinel the in-sandbox proxy relays to the harness.

    The sandbox RPC only carries string errors, and the in-container proxy exits the
    whole model-proxy process on any raised method -- tearing down the agent's live
    session. To keep the bridge transparent, a provider API error is caught and
    RETURNED as a structured sentinel instead of raised; the proxy detects it and
    replays the real HTTP status and body to the harness, which then applies its own
    retry / error handling (exactly as if it had called the provider directly).

    Returns None for anything that is not a provider API error (i.e. a genuine bridge
    bug), which is re-raised and still fails the proxy hard.
    """
    api_error_types = _provider_api_error_types()
    if not api_error_types or not isinstance(ex, api_error_types):
        return None
    status = getattr(ex, "status_code", None)
    if not isinstance(status, int):
        status = getattr(ex, "code", None)  # google-genai carries the status on .code
    if not isinstance(status, int):
        # a connection / timeout error has no HTTP status -- surface it as a 503
        status = 503
    body = getattr(ex, "body", None)
    if not isinstance(body, (dict, list)):
        body = {"type": "error", "error": {"type": "api_error", "message": str(ex)}}
    return {_BRIDGE_ERROR_KEY: {"status": status, "body": body}}


async def run_model_service(
    sandbox: SandboxEnvironment,
    web_search: WebSearchProviders,
    code_execution: CodeExecutionProviders,
    bridge: SandboxAgentBridge,
    instance: str,
    started: anyio.Event,
) -> None:
    await sandbox_service(
        name=MODEL_SERVICE,
        methods={
            "generate_completions": generate_completions(bridge),
            "generate_responses": generate_responses(
                web_search, code_execution, bridge
            ),
            "generate_anthropic": generate_anthropic(
                web_search, code_execution, bridge
            ),
            "generate_google": generate_google(web_search, code_execution, bridge),
            "list_tools": list_tools(bridge),
            "call_tool": call_tool(bridge),
        },
        until=lambda: False,
        sandbox=sandbox,
        instance=instance,
        polling_interval=2,
        started=started,
        requires_python=False,
    )


def generate_completions(
    bridge: SandboxAgentBridge,
) -> Callable[[dict[str, JsonValue]], Awaitable[dict[str, JsonValue]]]:
    async def generate(json_data: dict[str, JsonValue]) -> dict[str, JsonValue]:
        try:
            completion = await inspect_completions_api_request(json_data, None, bridge)
            return completion.model_dump(mode="json", warnings=False)
        except Exception as ex:
            error_result = _api_error_result(ex)
            if error_result is not None:
                return error_result
            raise

    return generate


def generate_responses(
    web_search: WebSearchProviders,
    code_execution: CodeExecutionProviders,
    bridge: SandboxAgentBridge,
) -> Callable[[dict[str, JsonValue]], Awaitable[dict[str, JsonValue]]]:
    async def generate(json_data: dict[str, JsonValue]) -> dict[str, JsonValue]:
        try:
            completion = await inspect_responses_api_request(
                json_data, None, web_search, code_execution, bridge
            )
            return completion.model_dump(mode="json", warnings=False)
        except Exception as ex:
            error_result = _api_error_result(ex)
            if error_result is not None:
                return error_result
            raise

    return generate


def generate_anthropic(
    web_search: WebSearchProviders,
    code_execution: CodeExecutionProviders,
    bridge: SandboxAgentBridge,
) -> Callable[[dict[str, JsonValue]], Awaitable[dict[str, JsonValue]]]:
    async def generate(json_data: dict[str, JsonValue]) -> dict[str, JsonValue]:
        try:
            completion = await inspect_anthropic_api_request(
                json_data, None, web_search, code_execution, bridge
            )
            return completion.model_dump(mode="json", warnings=False)
        except Exception as ex:
            error_result = _api_error_result(ex)
            if error_result is not None:
                return error_result
            raise

    return generate


def generate_google(
    web_search: WebSearchProviders,
    code_execution: CodeExecutionProviders,
    bridge: SandboxAgentBridge,
) -> Callable[[dict[str, JsonValue]], Awaitable[dict[str, JsonValue]]]:
    async def generate(json_data: dict[str, JsonValue]) -> dict[str, JsonValue]:
        try:
            completion = await inspect_google_api_request(
                json_data, web_search, code_execution, bridge
            )
            return completion
        except Exception as ex:
            error_result = _api_error_result(ex)
            if error_result is not None:
                return error_result
            raise

    return generate


def list_tools(
    bridge: SandboxAgentBridge,
) -> Callable[[str], Awaitable[JsonValue]]:
    """Return tool schemas for a bridged tools server."""

    async def execute(server: str) -> JsonValue:
        if server not in bridge.bridged_tools:
            raise ValueError(f"Unknown bridged tools server: {server}")

        tools = list(bridge.bridged_tools[server].values())
        tools_info = get_tools_info(tools)

        return [
            {
                "name": info.name,
                "description": info.description,
                "inputSchema": info.parameters.model_dump(exclude_none=True),
            }
            for info in tools_info
        ]

    return execute


def call_tool(
    bridge: SandboxAgentBridge,
) -> Callable[[str, str, dict[str, Any]], Awaitable[str]]:
    """Execute a bridged tool and return result."""

    async def execute(server: str, tool: str, arguments: dict[str, Any]) -> str:
        if server not in bridge.bridged_tools:
            raise ValueError(f"Unknown bridged tools server: {server}")

        server_tools = bridge.bridged_tools[server]
        if tool not in server_tools:
            raise ValueError(f"Unknown tool '{tool}' in server '{server}'")

        tool_fn = server_tools[tool]
        result = await tool_fn(**arguments)

        # Plain strings are returned verbatim (the MCP `tools/call` text part
        # carries them as-is). For anything else, use pydantic_core.to_json so
        # Pydantic models (e.g. list[ContentText] from real MCP tools) are
        # serialized correctly — json.dumps can't handle BaseModel.
        if isinstance(result, str):
            return result
        return to_json_str_safe(result)

    return execute
