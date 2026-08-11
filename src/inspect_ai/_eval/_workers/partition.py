"""Stable assignment of selected samples to eval-set workers."""

from inspect_ai.dataset._util import normalise_sample_id


def partition_samples(
    selected_ids: list[int | str], workers: int
) -> list[list[int | str]]:
    """Split selected sample ids into disjoint, balanced stable shards."""
    if workers < 1:
        raise ValueError(f"workers must be positive (got {workers})")

    ordered = sorted(selected_ids, key=normalise_sample_id)
    shards: list[list[int | str]] = [[] for _ in range(min(workers, len(ordered)))]
    for position, sample_id in enumerate(ordered):
        shards[position % len(shards)].append(sample_id)
    return shards
