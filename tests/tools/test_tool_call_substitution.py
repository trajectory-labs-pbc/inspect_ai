from inspect_ai.tool._tool_call import ToolCallContent, substitute_tool_call_content


class TestSubstituteToolCallContent:
    def test_basic_substitution(self) -> None:
        content = ToolCallContent(
            title="Run {{command}}",
            format="text",
            content="Executing: {{command}}",
        )
        result = substitute_tool_call_content(content, {"command": "ls -la"})
        assert result.title == "Run ls -la"
        assert result.content == "Executing: ls -la"

    def test_missing_key_left_as_is(self) -> None:
        content = ToolCallContent(
            title="{{missing}}",
            format="text",
            content="Value: {{missing}}",
        )
        result = substitute_tool_call_content(content, {"other": "val"})
        assert result.title == "{{missing}}"
        assert result.content == "Value: {{missing}}"

    def test_title_and_content_both_substituted(self) -> None:
        content = ToolCallContent(
            title="{{action}} {{target}}",
            format="markdown",
            content="# {{action}}\nTarget: {{target}}",
        )
        result = substitute_tool_call_content(
            content, {"action": "Delete", "target": "file.txt"}
        )
        assert result.title == "Delete file.txt"
        assert result.content == "# Delete\nTarget: file.txt"

    def test_rich_markup_in_values(self) -> None:
        content = ToolCallContent(
            title="Code: {{code}}",
            format="text",
            content="{{code}}",
        )
        result = substitute_tool_call_content(content, {"code": "[red]danger[/red]"})
        assert result.title == "Code: [red]danger[/red]"
        assert result.content == "[red]danger[/red]"

    def test_empty_arguments(self) -> None:
        content = ToolCallContent(
            title="{{key}}",
            format="text",
            content="Hello {{key}}",
        )
        result = substitute_tool_call_content(content, {})
        assert result.title == "{{key}}"
        assert result.content == "Hello {{key}}"

    def test_none_title(self) -> None:
        content = ToolCallContent(
            format="text",
            content="Value: {{x}}",
        )
        result = substitute_tool_call_content(content, {"x": "42"})
        assert result.title is None
        assert result.content == "Value: 42"

    def test_original_not_mutated(self) -> None:
        content = ToolCallContent(
            title="{{key}}",
            format="text",
            content="{{key}}",
        )
        substitute_tool_call_content(content, {"key": "val"})
        assert content.title == "{{key}}"
        assert content.content == "{{key}}"


class TestToolViewAsStr:
    def test_substituted_content(self) -> None:
        from inspect_ai.analysis._dataframe.events.extract import tool_view_as_str
        from inspect_ai.event._tool import ToolEvent

        event = ToolEvent(
            id="1",
            function="code",
            arguments={"code": "print('hello')"},
            view=ToolCallContent(
                title="Code: {{code}}",
                format="text",
                content="{{code}}",
            ),
        )
        result = tool_view_as_str(event)
        assert result == "Code: print('hello')\n\nprint('hello')"

    def test_none_view(self) -> None:
        from inspect_ai.analysis._dataframe.events.extract import tool_view_as_str
        from inspect_ai.event._tool import ToolEvent

        event = ToolEvent(
            id="1",
            function="code",
            arguments={"code": "x"},
        )
        assert tool_view_as_str(event) is None
