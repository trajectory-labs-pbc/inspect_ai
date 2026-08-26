"""`to_overview` carries eval metadata into the listing.

The log list renders metadata columns off `listing.json` alone. Dropping this
field would send the viewer back to fetching every log's header to show them,
which is the cost the listing exists to avoid.
"""

from inspect_ai.log import EvalLog
from inspect_ai.log._edit import MetadataEdit, ProvenanceData, edit_eval_log
from inspect_ai.log._file import to_overview


def header(**kwargs: object) -> EvalLog:
    log = EvalLog.model_validate(
        {
            "version": 2,
            "status": "success",
            "eval": {
                "run_id": "run-1",
                "created": "2026-08-26T00:00:00+00:00",
                "task": "attack-task",
                "task_id": "task-1",
                "task_version": 0,
                "model": "mockllm/model",
                "dataset": {},
                "config": {},
                **kwargs,
            },
        }
    )
    return log


def test_eval_metadata_reaches_the_overview() -> None:
    attack = {"goal": "exfiltrate credentials", "entered_via": "tool response"}

    overview = to_overview(header(metadata={"attack": attack}))

    assert overview.metadata == {"attack": attack}


def test_absent_metadata_stays_absent() -> None:
    # EvalLog.metadata defaults to {}, so without the `or None` normalization
    # every listing entry would carry a meaningless empty object.
    overview = to_overview(header())

    assert overview.metadata is None
    assert "metadata" not in overview.model_dump(exclude_none=True)


def test_post_hoc_edits_win_over_eval_time_values() -> None:
    log = edit_eval_log(
        header(metadata={"attack": {"goal": "stale"}}),
        [MetadataEdit(metadata_set={"attack": {"goal": "corrected"}})],
        ProvenanceData(author="reviewer", reason="fixed the goal wording"),
    )

    overview = to_overview(log)

    assert overview.metadata == {"attack": {"goal": "corrected"}}
