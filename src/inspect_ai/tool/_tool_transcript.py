from pydantic import JsonValue
from rich.console import RenderableType
from rich.markup import escape
from rich.text import Text
from typing_extensions import Protocol

from inspect_ai._util.transcript import transcript_function, transcript_markdown

from ._tool_call import ToolCallContent, substitute_tool_call_content


class TranscriptToolCall(Protocol):
    function: str
    arguments: dict[str, JsonValue]
    view: ToolCallContent | None


def transcript_tool_call(call: TranscriptToolCall) -> list[RenderableType]:
    content: list[RenderableType] = []
    if call.view:
        view = substitute_tool_call_content(call.view, call.arguments)
        if view.title:
            content.append(Text.from_markup(f"[bold]{escape(view.title)}[/bold]\n"))
        if view.format == "markdown":
            content.append(transcript_markdown(view.content))
        else:
            content.append(view.content)
    else:
        content.append(transcript_function(call.function, call.arguments))
    return content
