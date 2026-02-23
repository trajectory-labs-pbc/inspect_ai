from pathlib import Path

import yaml

PATH = Path(__file__).parent

CATEGORY_ORDER = [
    "Tooling",
    "Frameworks",
    "Suites & Agents",
    "Analysis",
    "Sandboxes",
]

SECTION_IDS = {
    "Tooling": "sec-tooling",
    "Frameworks": "sec-frameworks",
    "Suites & Agents": "sec-suites",
    "Analysis": "sec-analysis",
    "Sandboxes": "sec-sandboxes",
}

DESCRIPTIONS = {
    "Tooling": "Extensions that support the development and execution of Inspect evaluations.",
    "Frameworks": "Domain-specific frameworks for building and running evaluations in areas such as cybersecurity, AI safety, and alignment.",
    "Suites & Agents": "Pre-built benchmark suites and agent scaffolds for running standardized evaluations.",
    "Analysis": "Tools for analyzing evaluation transcripts, visualizing results, and integrating with experiment tracking platforms.",
    "Sandboxes": "Alternative sandbox backends for running evaluation tool calls in cloud and on-premises infrastructure.",
}

with open(PATH / "extensions.yml", "r") as f:
    records = yaml.safe_load(f)

groups: dict[str, list] = {cat: [] for cat in CATEGORY_ORDER}
for record in records:
    cat = record.get("categories", ["Tooling"])[0]
    if cat in groups:
        groups[cat].append(record)

lines = []
for cat, items in groups.items():
    lines.append(f"## {cat} {{#{SECTION_IDS[cat]}}}")
    lines.append("")
    lines.append(DESCRIPTIONS[cat])
    lines.append("")
    lines.append("| Name | Description | Author |")
    lines.append("|------|-------------|--------|")
    for item in items:
        name = item.get("name", "").strip()
        desc = item.get("description", "").strip().replace("\n", " ")
        author = item.get("author", "").strip()
        lines.append(f"| {name} | {desc} | {author} |")
    lines.append("")

with open(PATH / "extensions_content.md", "w") as f:
    f.write("\n".join(lines))
